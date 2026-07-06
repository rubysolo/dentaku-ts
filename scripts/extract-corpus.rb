#!/usr/bin/env ruby
# frozen_string_literal: true

# extract-corpus.rb — extract every unique (formula, variables) pair exercised
# by the Ruby dentaku v3.5.7 spec suite.
#
# Usage:
#   ruby scripts/extract-corpus.rb [path-to-dentaku-checkout] > pairs.json
#
# The checkout defaults to $DENTAKU_REF or /tmp/dentaku-ref and must be at tag
# v3.5.7 (git clone https://github.com/rubysolo/dentaku && git checkout v3.5.7).
#
# What gets extracted (via Prism source parsing, not regex-on-quotes):
#   * literal-string first arguments of evaluate / evaluate! / tokenize /
#     parse / ast / dependencies / Dentaku / Dentaku! calls, plus the literal
#     variable-context hash passed alongside (evaluate-family only)
#   * the second argument of store_formula calls
#   * formula strings inside literal hashes passed to solve / solve!, and all
#     string values of expression hashes in the bulk-solver / dependency-
#     resolver specs (nested hashes and arrays included)
#   * a tiny supplemental list required by issue 002's spot-check protocol
#     (formulas the verification protocol pins but the spec suite never
#     spells literally)
#
# What gets skipped (logged to stderr):
#   * formulas that call a custom function registered inside the spec suite
#     (add_function / add_functions / aliases) — custom-function behavior is
#     covered by translated specs, not the oracle
#   * non-literal formula arguments (variables, interpolated strings)
#   * non-literal context values (lambdas, Time.local(...), let-bound values);
#     the remaining literal keys are kept, so such formulas usually become
#     UnboundVariableError entries — which are valid corpus entries
#
# Output: JSON array of {"formula": String, "vars": Object} sorted by
# [formula, canonical vars JSON], unique by the same key.

require "json"
require "prism"

REF = ARGV[0] || ENV["DENTAKU_REF"] || "/tmp/dentaku-ref"
SPEC_DIR = File.join(REF, "spec")
abort "dentaku checkout not found at #{REF} (spec/ missing)" unless Dir.exist?(SPEC_DIR)

# Load the gem itself (from the checkout) purely to enumerate builtin function
# names, so the custom-function skip never misfires on a builtin.
$LOAD_PATH.unshift File.join(REF, "lib")
require "dentaku"
BUILTIN_FUNCTIONS = Dentaku::AST::FunctionRegistry.default.keys.map(&:downcase).freeze

# parsed / visit_nodes are file-local spec helpers (print_visitor_spec,
# visitor_spec) that tokenize + parse their string argument.
FORMULA_METHODS = %i[evaluate evaluate! tokenize parse ast dependencies Dentaku Dentaku! parsed visit_nodes].freeze
SOLVE_METHODS = %i[solve solve!].freeze
# Files whose expression hashes (name => formula) feed the bulk solver /
# dependency resolver; every string value in a literal hash there is a formula.
HASH_HARVEST_FILES = %w[bulk_expression_solver_spec.rb dependency_resolver_spec.rb].freeze

# Formulas required verbatim by the issue 002 spot-check protocol but not
# spelled literally anywhere in the Ruby spec suite.
SUPPLEMENTAL_PAIRS = [
  { formula: "5 / 2", vars: {} },
  { formula: "0.1 + 0.2 == 0.3", vars: {} },
].freeze

NONLITERAL = Object.new

# --- literal conversion -----------------------------------------------------

def literal_value(node, notes, locals)
  case node
  when Prism::IntegerNode, Prism::FloatNode then node.value
  when Prism::StringNode then node.unescaped
  when Prism::SymbolNode then node.unescaped # symbols serialize as strings
  when Prism::TrueNode then true
  when Prism::FalseNode then false
  when Prism::NilNode then nil
  when Prism::LocalVariableReadNode
    # specs often bind a literal to a local first (value = '2023-01-01';
    # evaluate!('value + duration(1, month)', { value: value }))
    locals.fetch(node.name, NONLITERAL)
  when Prism::ArrayNode
    items = node.elements.map { |el| literal_value(el, notes, locals) }
    items.any? { |i| i.equal?(NONLITERAL) } ? NONLITERAL : items
  when Prism::HashNode, Prism::KeywordHashNode
    literal_hash(node, notes, locals) || NONLITERAL
  else
    NONLITERAL
  end
end

# Returns { "key" => value } with non-literal values dropped (recorded in
# notes), or nil if the node contains non-assoc elements (splats etc.).
def literal_hash(node, notes, locals)
  vars = {}
  node.elements.each do |assoc|
    return nil unless assoc.is_a?(Prism::AssocNode)
    key = case assoc.key
          when Prism::SymbolNode, Prism::StringNode then assoc.key.unescaped
          else return nil
          end
    value = literal_value(assoc.value, notes, locals)
    if value.equal?(NONLITERAL)
      notes << "dropped non-literal context value for key #{key.inspect}"
    else
      vars[key] = value
    end
  end
  vars
end

# --- pass 1: custom function / alias names registered by the specs ----------

def collect_custom_names(files)
  names = []
  files.each do |file|
    src = File.read(file)
    # calculator.add_function(:name, ...) / described_class.add_function(:name, ...)
    names.concat(src.scan(/add_function\(\s*:([a-zA-Z_]\w*[!?]?)/).flatten)
    # add_functions arrays: [:name, :type, ->(...)] entries (the lambda is what
    # distinguishes these from token-symbol fixture arrays)
    names.concat(src.scan(/\[\s*:([a-zA-Z_]\w*[!?]?)\s*,\s*:\w+\s*,\s*->/).flatten)
    # aliases: { round: ['rrround'] } / Dentaku.aliases = { roundup: ['roundupup'] }
    # (alias names may be non-latin, e.g. '如果')
    src.scan(/aliases.*?\{([^}]*)\}/m).flatten.each do |body|
      names.concat(body.scan(/['"]([^'"]+)['"]/).flatten)
    end
  end
  names.map(&:downcase).uniq.sort - BUILTIN_FUNCTIONS
end

# --- pass 2: walk spec ASTs for formula-bearing calls ------------------------

class Extraction
  attr_reader :pairs, :skipped_custom, :skipped_nonliteral, :notes

  def initialize(custom_names)
    @custom_names = custom_names
    @pairs = {}
    @skipped_custom = []
    @skipped_nonliteral = 0
    @notes = Hash.new { |h, k| h[k] = [] }
  end

  def add(formula, vars)
    called = formula.scan(/([a-zA-Z_]\w*[!?]?)\s*\(/).flatten.map(&:downcase)
    if (hits = called & @custom_names).any?
      @skipped_custom << { formula: formula, custom_functions: hits }
      return
    end
    key = [formula, canonical(vars)]
    @pairs[key] ||= { formula: formula, vars: vars }
  end

  def skip_nonliteral
    @skipped_nonliteral += 1
  end

  private

  def canonical(value)
    case value
    when Hash then JSON.generate(value.sort.to_h { |k, v| [k, canonical(v)] })
    when Array then JSON.generate(value.map { |v| canonical(v) })
    else JSON.generate(value)
    end
  end
end

# Walks a spec file in source order, tracking literal local-variable
# assignments (formula = <<-FORMULA ..., value = '2023-01-01') so that
# variable-referencing call sites still yield literal pairs.
def walk(node, extraction, locals, harvest_hashes:)
  return unless node

  case node
  when Prism::LocalVariableWriteNode
    locals[node.name] = literal_value(node.value, [], locals)
  when Prism::CallNode
    handle_call(node, extraction, locals)
  when Prism::HashNode, Prism::KeywordHashNode
    harvest_hash_formulas(node, extraction) if harvest_hashes
  end

  node.compact_child_nodes.each { |child| walk(child, extraction, locals, harvest_hashes: harvest_hashes) }
end

def handle_call(node, extraction, locals)
  name = node.name
  args = node.arguments&.arguments || []

  if SOLVE_METHODS.include?(name)
    args.each { |arg| harvest_hash_formulas(arg, extraction) if arg.is_a?(Prism::HashNode) || arg.is_a?(Prism::KeywordHashNode) }
    return
  end

  if name == :store_formula
    formula_node = args[1]
    extraction.add(formula_node.unescaped, {}) if formula_node.is_a?(Prism::StringNode)
    return
  end

  return unless FORMULA_METHODS.include?(name)
  formula = literal_value(args[0], [], locals)
  unless formula.is_a?(String)
    # interpolated strings, let-bound values, AST-node fixtures — not extractable
    extraction.skip_nonliteral if args[0] && !args[0].is_a?(Prism::HashNode)
    return
  end

  vars = {}
  if %i[evaluate evaluate! dependencies Dentaku Dentaku!].include?(name)
    notes = []
    args[1..].each do |arg|
      next unless arg.is_a?(Prism::HashNode) || arg.is_a?(Prism::KeywordHashNode)
      vars.merge!(literal_hash(arg, notes, locals) || {})
    end
    notes.each { |n| extraction.notes[formula] << n }
  end
  # tokenize/parse extra args are scanner/parser options, never variables.

  extraction.add(formula, vars)
end

# Collect every string *value* reachable inside a literal hash (values may be
# nested hashes or arrays of formula strings, per the bulk-solver specs).
def harvest_hash_formulas(node, extraction)
  case node
  when Prism::HashNode, Prism::KeywordHashNode
    node.elements.each do |assoc|
      harvest_hash_formulas(assoc.value, extraction) if assoc.is_a?(Prism::AssocNode)
    end
  when Prism::ArrayNode
    node.elements.each { |el| harvest_hash_formulas(el, extraction) }
  when Prism::StringNode
    extraction.add(node.unescaped, {})
  end
end

# --- main --------------------------------------------------------------------

spec_files = Dir.glob(File.join(SPEC_DIR, "**", "*.rb")).sort
custom_names = collect_custom_names(spec_files)
warn "custom function/alias names registered by specs (calls to these are skipped): #{custom_names.join(', ')}"

extraction = Extraction.new(custom_names)
spec_files.each do |file|
  result = Prism.parse(File.read(file))
  unless result.success?
    warn "SKIP FILE (parse failure): #{file}"
    next
  end
  walk(result.value, extraction, {}, harvest_hashes: HASH_HARVEST_FILES.include?(File.basename(file)))
end

SUPPLEMENTAL_PAIRS.each { |pair| extraction.add(pair[:formula], pair[:vars]) }

pairs = extraction.pairs.values.sort_by { |p| [p[:formula], JSON.generate(p[:vars])] }

warn ""
warn "extracted #{pairs.size} unique (formula, vars) pairs (#{pairs.map { |p| p[:formula] }.uniq.size} unique formulas)"
warn "skipped #{extraction.skipped_custom.size} custom-function cases:"
extraction.skipped_custom.uniq.each { |s| warn "  #{s[:formula].inspect} (uses: #{s[:custom_functions].join(', ')})" }
warn "skipped #{extraction.skipped_nonliteral} calls with non-literal formula arguments"
extraction.notes.each { |formula, notes| notes.uniq.each { |n| warn "note: #{formula.inspect}: #{n}" } }

puts JSON.pretty_generate(pairs)
