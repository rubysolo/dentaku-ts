# dentaku-ts — AFK Build Plan

TypeScript spiritual successor to the Ruby [dentaku](https://github.com/rubysolo/dentaku) gem (v3.5.7 is the reference implementation). This plan is written to be executed unattended. Read `CONTEXT.md` for canonical terminology and `docs/adr/` for the decisions this plan implements; do not re-litigate ADRs during the build.

## Decision register

| Decision | Resolution | Where |
|---|---|---|
| Fidelity contract | Spiritual successor: same surface syntax + function catalog, five tightenings, redesigned host API | ADR-0003 |
| Numerics | decimal.js internally; `number` out by default, Decimal opt-in | ADR-0001 |
| Error posture | `evaluate()` throws typed errors; `tryEvaluate()` returns `T \| undefined` | ADR-0002 |
| Dates | Internal civil date-time type; `DATE()` constructor; no string→date coercion; bare date literals opt-in | ADR-0004 |
| Lambdas | Identifier form only (`map(items, x, x * 2)`); arrow syntax is 1.x backlog |
| State model | Mutable `store()` memory + transient per-call variables; no block-transaction form |
| Functions | Instance-only registry, typed descriptor; **no global registry of any kind** |
| Batch API | `solve()` throws on first failure; `trySolve()` returns `{ values, errors }` maps |
| v1 scope | Core + bulk solve/dependencies + nested data + quoted identifiers + formula printer. Backlog: i18n aliases, arrow lambdas |
| Package | `dentaku` on npm, ESM-only, Node ≥20, runtime-neutral source (no Node APIs) |
| Toolchain | pnpm, vitest, tsdown, Biome, GitHub Actions (Node 20/22/24 matrix) |
| Verification | Ported RSpec suite + machine-generated Ruby oracle corpus with divergence allowlist |

## Language spec: deltas from Ruby dentaku 3.5.7

Everything not listed here matches the Ruby gem's observable behavior. The Ruby source is the spec of record; a full semantic reference of it was compiled during planning — key facts are inlined below where they matter.

### Tightenings (ADR-0003/0004)

1. **Identifiers are case-sensitive.** Function names remain case-insensitive (`SUM` = `sum`). Constructor option `caseInsensitiveIdentifiers: true` restores Ruby behavior (downcase identifiers and memory keys).
2. **Strict booleans in conditionals.** `if(pred, a, b)`, `and`/`or`/`&&`/`||`, `not()`, `xor()` require boolean operands; anything else throws `TypeMismatchError`. Combinators return booleans, not operand values.
3. **No string→number coercion in arithmetic or comparators.** `"2" + 2` throws `TypeMismatchError`. (Ruby coerced context values at eval time while rejecting string literals at parse time.)
4. **Conventional bitwise precedence** — see precedence table below (Ruby had `| & << >>` at precedence 0).
5. **Bare date literals off by default.** `2020-1-1` is arithmetic (= 2018). Constructor option `dateLiterals: true` enables the Ruby tokenizer behavior (`\d{2}\d{2}?-\d{1,2}-\d{1,2}` datetime regex, scanned before numeric).

### Removals (host-level, not formula-level)

- No global function registry, no global aliases, no global cache flags, no `const_set`-style side effects. All state is per-Calculator.
- No identifier-cache mutation of caller-provided variable objects (Ruby's `cache_identifier` mode mutated the context hash).
- No array-of-formulas overload on `evaluate()` (callers can `.map`).
- Ruby's `Float` leaks are fixed: percentage (`50%`), `roundup`/`rounddown` stay exact Decimal.

### Additions

- `DATE(isoString)` / `DATE(y, m, d)` built-in (the only way to construct a date inside formula text besides opt-in literals).
- `trySolve` reports per-key errors instead of Ruby's `:undefined` symbol; in a dependency cycle, only the keys participating in (or downstream of) the cycle fail with `CycleError` — independent keys still solve (improvement over Ruby, which abandoned the whole batch).

### Kept Ruby behaviors worth calling out (do NOT "fix" these)

- `5 / 2` = exactly `2.5` — division always produces a decimal result; never integer division. `%` (binary) is modulo with decimal divisor; `^` is exponentiation, **left-associative** (matching Ruby dentaku, not math convention); unary `-` binds tighter than `^` and is right-associative.
- Postfix `%` = percentage (`50% * 2` → `1`). Disambiguation from modulo is by lookahead, exactly as Ruby: `%` followed by nothing, an operator, or a closing paren is percentage; otherwise modulo.
- `=` and `==` both mean equality; `<>` and `!=` both mean inequality. String comparison is lexicographic.
- Excel lineage: `MID`/`FIND` are 1-based; `SUBSTITUTE` replaces first occurrence only; `LEFT`/`RIGHT` clamp; function names in any case.
- `null` literal; `and`/`or` word forms and `&&`/`||` (combinator tokens require trailing whitespace after word forms, per Ruby regex `(and|or|&&|\|\|)\s`).
- Comments: C-style `/* ... */` only, stripped pre-tokenization.
- Numeric literals: integers, decimals, leading-dot (`.5`), scientific (`1.5E-10`), hex (`0xFF`). No underscores/thousands separators.
- Strings: single- or double-quoted, **no escape sequences** (a quote char cannot appear inside same-quoted string).
- Array literals `{1, 2, 3}` (may be empty); index/key access `a[expr]` works on arrays and objects.
- `CASE x WHEN a THEN r [WHEN...] [ELSE d] END`; `switch(value, k1, v1, ..., default?)`.
- Backtick-quoted identifiers for names with spaces/punctuation.
- `duration(n, year|month|day)` (singular/plural units); date ± duration; date − date (days); date ± number (days); month/year arithmetic clamps to end of month (Ruby `Date#>>` semantics).
- Enum functions accept a scalar as a 1-element collection and `null` as empty (Ruby `Array()` semantics); `pluck` requires an array of objects, optional default (3rd arg); `reduce(coll, memo, item, expr, initial?)` with `initial` defaulting to undefined→`null`.
- `count(x)` returns `x`'s length if the single argument has one, else the argument count. `mul`/`sum`/`avg`/`min`/`max` flatten nested arrays; `sum`/`mul`/`avg` require ≥1 argument.

## Architecture

```
src/
  index.ts             // public exports
  calculator.ts        // Calculator class (API below)
  errors.ts            // error taxonomy
  values.ts            // Value union, type guards, boundary conversions (Decimal↔number, CivilDateTime↔Date)
  decimal.ts           // decimal.js re-export + configuration (precision 20, ROUND_HALF_UP)
  civil-date.ts        // CivilDateTime value type + month-clamped arithmetic; Duration value type
  tokenizer/
    token.ts           // Token {category, value, raw, position}
    scanners.ts        // ordered scanner table (preserve Ruby order: null, whitespace, [datetime], numeric, hex, strings, negate, combinator, operator, grouping, array, access, case, comparator, boolean, function, identifier, quoted-identifier)
    tokenizer.ts       // comment stripping, scan loop, paren balance, position tracking
    numeric.ts         // literal parsing → Decimal (int and decimal forms both become Decimal)
  parser/
    parser.ts          // shunting yard (two stacks + arity stack), CASE assembly, array/access/grouping handling
    precedence.ts      // table below
  ast/
    node.ts            // base Node: value(ctx), dependencies(ctx), accept(visitor), type
    arithmetic.ts comparators.ts combinators.ts bitwise.ts negation.ts percentage.ts
    literal.ts identifier.ts array.ts access.ts grouping.ts case.ts nil.ts
    function-node.ts   // generic function-call node bound to a FunctionDef
  functions/
    registry.ts        // FunctionRegistry (per Calculator), FunctionSet (shareable, immutable)
    types.ts           // FunctionDef {name, returnType: 'numeric'|'string'|'logical'|'list'|'duration'|'datetime'|'any', fn, minArgs?, maxArgs?}
    logic.ts numeric.ts string.ts collection.ts date.ts math.ts
  solver/
    dependency-graph.ts // toposort + cycle detection (Tarjan or Kahn; report cycle membership)
    bulk-solver.ts      // facts-first evaluation, per-key error capture, nested-key flatten/expand
  data/
    flatten.ts         // nested-object flatten with intermediates ('.' separator) + expand
  printer.ts           // AST → canonical formula string (parenthesize by precedence; percentage spacing '')
tests/
  oracle/corpus.json          // committed golden corpus
  oracle/allowlist.json       // divergence allowlist (entry → ADR tightening id + expected TS behavior)
  oracle.spec.ts              // corpus runner
  <area>.spec.ts              // translated RSpec suites (tokenizer, parser, calculator, each function, solver, printer)
  roundtrip.spec.ts           // parse→print→parse property tests
scripts/
  generate-oracle.rb          // runs Ruby gem over extracted formulas (regeneration; not run in CI)
  extract-corpus.rb           // pulls (formula, context, expected) triples from the gem's spec files
```

### Precedence table (successor)

| Prec | Operators | Assoc |
|---|---|---|
| 50 | unary `-` | right |
| 40 | `^` (pow), postfix `%` | left |
| 30 | `*` `/` `%` (mod) | left |
| 20 | `+` `-` | left |
| 15 | `<<` `>>` | left |
| 12 | `&` | left |
| 11 | `\|` | left |
| 5 | `<` `>` `<=` `>=` `=` `==` `!=` `<>` | left |
| 2 | `and` `&&` | left |
| 1 | `or` `\|\|` | left |

(Ruby reference: negation 40, pow/percent 30, mul/div/mod 20, add/sub 10, comparators 5, bitwise and combinators 0. Only rows 15/12/11 are the ADR-0003 tightening; the rest is a rescaled identity.)

### Value model

```ts
type Value = Decimal | string | boolean | null | CivilDateTime | Duration | Value[] | { [k: string]: Value }
```

External boundary accepts `number | bigint | string | boolean | null | Date | arrays/objects thereof` and converts inward once; `evaluate()` converts outward (`Decimal→number`, `CivilDateTime→Date`) unless `{ raw: true }`.

### Error taxonomy

`DentakuError` (base, carries `formula` and, when solving, `key`) ← `ParseError` (tokenize + parse failures, with position and reason code), `UnboundVariableError` (carries `unboundVariables: string[]`), `TypeMismatchError`, `ArgumentCountError`, `ZeroDivisionError`, `MathDomainError`, `CycleError` (carries cycle members). `evaluate`'s try-variant catches exactly `DentakuError` subclasses — never `TypeError`/`RangeError` etc., which indicate bugs and must propagate.

### Host API

```ts
new Calculator(options?: {
  caseInsensitiveIdentifiers?: boolean  // default false (tightening 1)
  dateLiterals?: boolean                // default false (tightening 5)
  nestedData?: boolean                  // default true
  astCache?: boolean | Map<string, Node> // default false; true = internal Map
  functions?: FunctionSet               // extra functions at construction
})
calc.evaluate(formula, vars?) / calc.tryEvaluate(formula, vars?)
calc.evaluate(formula, vars, { raw: true })  // Decimal/CivilDateTime out
calc.solve(formulasByName, vars?)            // throws first error incl. CycleError
calc.trySolve(formulasByName, vars?)         // { values: Record<string, unknown>, errors: Record<string, DentakuError> }
calc.dependencies(formula, vars?)            // string[] of unresolved identifiers
calc.store(nameOrObject, value?)  calc.storeFormula(name, formula)  calc.clear()
calc.addFunction(def: FunctionDef)  calc.addFunctions(defs)
calc.ast(formula)  calc.print(ast)           // printer round-trip surface
// module-level conveniences, stateless: evaluate(), tryEvaluate()
```

### Built-in function catalog (pinned)

- Logic: `if(pred, a, b)` (lazy branches), `and(...)`, `or(...)`, `xor(...)`, `not(x)`, `switch(v, k1, r1, ..., default?)`
- Numeric: `min` `max` `sum` `avg` `mul` `count` `round(n, places=0)` (half-up) `rounddown` `roundup` (toward/away from zero at given precision) `abs` `intercept(xs, ys)`
- String: `left` `right` `mid` `len` `find` `substitute` `concat` `contains`
- Collection: `map` `filter` `all` `any` (3-arg identifier-lambda form), `pluck(coll, key, default?)`, `reduce(coll, memo, item, expr, initial?)`
- Date: `date(...)` (new), `duration(n, unit)`
- Math (float64 via JS `Math`, result re-wrapped as Decimal): `sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh exp log log2 log10 sqrt cbrt hypot pow`. **Omitted from v1** (no JS equivalent): `erf erfc gamma lgamma frexp ldexp` — backlog, document in README. Domain errors (e.g. `sqrt(-1)`) throw `MathDomainError`, matching Ruby, rather than returning `NaN`.

## Verification protocol (the AFK honesty mechanism)

1. **Corpus extraction** (`scripts/extract-corpus.rb`): parse the gem's spec files for `(formula, context, expected)` triples; where expectations aren't literal in the spec, execute the gem to obtain them. Target: every unique formula in the suite (~400).
2. **Oracle generation** (`scripts/generate-oracle.rb`): run Ruby dentaku 3.5.7 (`gem install dentaku -v 3.5.7`, or clone + `ruby -Ilib`) over the corpus; emit `tests/oracle/corpus.json` entries: `{ formula, vars, result | error: <RubyErrorClass>, notes? }`. Serialize BigDecimal results as exact decimal strings, dates as ISO strings. Commit the JSON — CI never needs Ruby.
3. **Allowlist**: for each corpus entry whose TS result must differ, add an entry `{ formula, reason: "ADR-0003.<n>" | "ADR-0004", expected: <TS result or error class> }`. The oracle runner fails on (a) any unlisted mismatch and (b) any allowlist entry that stops diverging (stale allowlist).
4. **Translated specs**: port each RSpec file to a vitest file, adjusting only for tightenings (each adjustment annotated with its ADR reference in a comment).
5. **Round-trip properties**: for every corpus formula that parses, `print(parse(f))` reparses to a structurally equal AST.
6. CI gates: `tsc --noEmit`, Biome, vitest (unit + oracle + roundtrip), on Node 20/22/24.

## Milestones (each ends green: typecheck + lint + all tests written so far)

> **Execution note**: these milestones are decomposed into 15 parallel-executable issues in [docs/issues/](docs/issues/README.md), with a dependency graph, wave schedule, file-ownership rules, and frozen interface contracts. AFK agents should work from the issues, not this list.

0. **Scaffold**: pnpm project, tsconfig (strict, NodeNext), vitest, tsdown, Biome, CI workflow, MIT license, `.gitignore`, decimal.js dep. `git init` and commit per milestone.
1. **Oracle**: extraction + generation scripts, committed `corpus.json`, initial `allowlist.json` (entries added as milestones land; runner marks not-yet-implemented areas as todo, not failure).
2. **Values & errors**: Decimal config, Value union, boundary conversions, error classes, CivilDateTime + Duration with clamped month arithmetic (unit-tested against Ruby `Date#>>` cases: `2020-01-31 + 1 month = 2020-02-29`, etc.).
3. **Tokenizer**: all scanners in Ruby's order, positions, comment stripping, balance checks; `dateLiterals` flag; tokenizer spec ported.
4. **Parser + AST**: shunting yard, precedence table, CASE assembly, arrays, access, negation lookahead rules, percentage/modulo disambiguation, arity validation; parser spec ported. Strict-boolean and no-coercion checks live in AST `value()`.
5. **Evaluator core**: arithmetic, comparators, combinators, bitwise, case, access, identifiers + nested-data flatten, `null`; arithmetic/comparator/case specs ported with allowlisted tightening deltas.
6. **Functions**: registry + FunctionSet, full catalog above; every `spec/ast/*_spec.rb` ported.
7. **Calculator API**: evaluate/tryEvaluate, store/storeFormula/clear, addFunction(s), dependencies, ast cache, module-level conveniences; calculator spec ported.
8. **Solver**: dependency graph, cycle detection with membership, facts-first bulk solve, solve/trySolve, nested result keys; bulk-solver + dependency-resolver specs ported.
9. **Printer** + round-trip property suite.
10. **Oracle closure**: run full corpus; fix every unlisted mismatch or consciously extend the allowlist (only with an ADR-traceable reason); zero stale entries.
11. **Docs & polish**: README (successor pitch, migration-from-Ruby section listing the five tightenings with before/after, API docs), package.json metadata (`name: dentaku`, exports map, `sideEffects: false`), CHANGELOG stub, `pnpm publish --dry-run` clean.

## Out of scope (1.x backlog)

Arrow-lambda syntax for enum functions; i18n function aliases; `erf/erfc/gamma/lgamma/frexp/ldexp`; Temporal adapter; AST JSON serialization; benchmark suite vs Ruby.
