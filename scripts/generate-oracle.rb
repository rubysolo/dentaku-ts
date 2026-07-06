#!/usr/bin/env ruby
# frozen_string_literal: true

# generate-oracle.rb — execute Ruby dentaku v3.5.7 over the extracted
# (formula, vars) pairs and emit the oracle corpus.
#
# Usage:
#   ruby scripts/extract-corpus.rb /tmp/dentaku-ref > pairs.json
#   ruby -I /tmp/dentaku-ref/lib scripts/generate-oracle.rb pairs.json tests/oracle/corpus.json
#
# Every result is obtained by actually EXECUTING the gem (never hand-computed):
# a fresh default Dentaku::Calculator per entry, evaluate! inside a rescue
# harness. Exactly one of "result" / "error" per entry.
#
# Result encoding:
#   BigDecimal / Integer / Float -> {type:"decimal",  value:"<exact decimal string>"}
#   String                       -> {type:"string",   value:"..."}
#   true / false                 -> {type:"boolean",  value:true|false}
#   nil                          -> {type:"null"}
#   Date / DateTime / Time       -> {type:"datetime", value:"<ISO 8601>"}
#   Array                        -> {type:"array",    items:[...]} (recursive)
#   Rational (from `x ^ -n`)     -> {type:"decimal"} when exactly representable
#   Hash (from enum functions)   -> {type:"object",   entries:{...}} (recursive)
# Errors are recorded by Ruby class name without namespace
# (Dentaku::UnboundVariableError -> "UnboundVariableError").
#
# Entries whose Ruby tokenization consumed a bare date literal (a :datetime
# token) get "flags": {"dateLiterals": true} so the TS oracle runner enables
# the matching calculator option (ADR-0003 tightening 5 flips the default).
#
# Generation is pinned to TZ=UTC so datetime results are machine-independent
# (Ruby's Time.parse would otherwise stamp the local zone offset).

ENV["TZ"] = "UTC"

require "json"
require "bigdecimal"
require "date"
require "dentaku"
require "dentaku/tokenizer"

abort "usage: ruby -I <dentaku-lib> scripts/generate-oracle.rb pairs.json [out.json]" if ARGV.empty?
pairs = JSON.parse(File.read(ARGV[0]))
out_path = ARGV[1] || File.expand_path("../tests/oracle/corpus.json", __dir__)

# --- result encoding ---------------------------------------------------------

class UnencodableResult < StandardError; end

def decimal_string(str)
  # exact plain decimal, trailing fractional zeros trimmed ("2.50" -> "2.5",
  # "10.0" -> "10") so integers and integral BigDecimals encode identically
  s = str.sub(/(\.\d*?)0+\z/, '\1').sub(/\.\z/, "")
  s == "-0" ? "0" : s
end

def encode(value)
  case value
  when BigDecimal
    { "type" => "decimal", "value" => decimal_string(value.to_s("F")) }
  when Integer
    { "type" => "decimal", "value" => value.to_s }
  when Float
    raise UnencodableResult, "non-finite Float #{value}" unless value.finite?
    { "type" => "decimal", "value" => decimal_string(BigDecimal(value.to_s).to_s("F")) }
  when Rational
    # `2 ^ -1` etc. produce Rationals; encode only when exactly representable
    # as a decimal string (denominator 2^a * 5^b), which covers the corpus.
    big = BigDecimal(value, 40)
    raise UnencodableResult, "non-terminating Rational #{value}" unless big.to_r == value
    { "type" => "decimal", "value" => decimal_string(big.to_s("F")) }
  when String
    { "type" => "string", "value" => value }
  when true, false
    { "type" => "boolean", "value" => value }
  when nil
    { "type" => "null" }
  when Time, DateTime, Date
    { "type" => "datetime", "value" => value.iso8601 }
  when Array
    { "type" => "array", "items" => value.map { |v| encode(v) } }
  when Hash
    # enum functions can map over arrays of objects and return the objects
    { "type" => "object", "entries" => value.to_h { |k, v| [k.to_s, encode(v)] } }
  else
    raise UnencodableResult, "#{value.class}: #{value.inspect}"
  end
end

# --- bare-date-literal detection ---------------------------------------------

def consumed_date_literal?(formula)
  Dentaku::Tokenizer.new.tokenize(formula).any? { |t| t.category == :datetime }
rescue Exception # rubocop:disable Lint/RescueException -- tokenizer fixtures may blow up arbitrarily
  # Tokenization failed outright; fall back to the scanner's own regexp. A
  # quoted date can't false-positive here because the quote character blocks
  # the datetime scanner in real tokenization, and a formula that both fails
  # to tokenize and quotes a date does not occur in the corpus.
  formula.match?(Dentaku::TokenScanner::DATE_TIME_REGEXP)
end

# --- generation --------------------------------------------------------------

entries = []
skipped = []

pairs.each do |pair|
  formula = pair.fetch("formula")
  vars = pair.fetch("vars", {})

  entry = { "formula" => formula, "vars" => vars }

  begin
    result = Dentaku::Calculator.new.evaluate!(formula, vars)
    entry["result"] = encode(result)
  rescue UnencodableResult => e
    skipped << "#{formula.inspect}: unencodable result (#{e.message})"
    next
  rescue Exception => e # rubocop:disable Lint/RescueException -- the harness must record every failure class
    entry["error"] = e.class.name.split("::").last
  end

  entry["flags"] = { "dateLiterals" => true } if consumed_date_literal?(formula)

  entries << entry
end

entries.sort_by! { |e| [e["formula"], JSON.generate(e["vars"])] }

File.write(out_path, JSON.pretty_generate(entries) + "\n")

result_count = entries.count { |e| e.key?("result") }
error_count = entries.count { |e| e.key?("error") }
flagged = entries.count { |e| e.key?("flags") }
warn "wrote #{entries.size} entries to #{out_path}"
warn "  results: #{result_count}, errors: #{error_count}, dateLiterals-flagged: #{flagged}"
warn "  error breakdown: #{entries.filter_map { |e| e["error"] }.tally.sort_by { |_, n| -n }.map { |k, n| "#{k}=#{n}" }.join(', ')}"
skipped.each { |s| warn "SKIPPED: #{s}" }
