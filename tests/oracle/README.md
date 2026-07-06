# Oracle corpus

The machine-generated golden data for the verification protocol (PLAN.md, CONTEXT.md "Oracle corpus" / "Divergence allowlist"). `corpus.json` records what Ruby dentaku **3.5.7** actually does for every unique `(formula, variables)` pair exercised by its own spec suite; dentaku-ts must reproduce it exactly, minus the entries enumerated in `allowlist.json`. CI consumes the committed JSON and never runs Ruby.

## Regeneration

```sh
git clone https://github.com/rubysolo/dentaku /tmp/dentaku-ref
git -C /tmp/dentaku-ref checkout v3.5.7

ruby scripts/extract-corpus.rb /tmp/dentaku-ref > /tmp/pairs.json
ruby -I /tmp/dentaku-ref/lib scripts/generate-oracle.rb /tmp/pairs.json tests/oracle/corpus.json
pnpm exec biome format --write tests/oracle/corpus.json   # repo lint gate formats JSON
```

Requires Ruby ≥ 3.3 (Prism) with the `bigdecimal` gem. `extract-corpus.rb` parses the gem's `spec/**/*.rb` for formula-bearing calls and their literal variable contexts; `generate-oracle.rb` obtains every result by **executing the gem** (fresh default `Dentaku::Calculator` per entry inside a rescue harness) — expected values are never hand-computed. Generation pins `TZ=UTC` so datetime results are machine-independent. Skipped cases (formulas calling spec-registered custom functions, non-literal formula arguments, dropped non-literal context values) are logged to stderr by the extraction script. One generated pair is skipped by the generation script (logged): bare `duration(1, day)` evaluates to an internal `Dentaku::AST::Duration::Value` object with no documented encoding — durations only surface in the corpus as date-arithmetic operands.

Output is deterministic: entries are sorted by `[formula, JSON(vars)]` and pretty-printed with 2-space indent (then normalized by the Biome formatter, which is itself deterministic), so regeneration diffs cleanly.

## corpus.json schema

An array of entries. Each entry has exactly one of `result` / `error`:

```json
{ "formula": "5 / 2", "vars": {}, "result": { "type": "decimal", "value": "2.5" } }
{ "formula": "10 * x", "vars": {}, "error": "UnboundVariableError" }
```

| field | meaning |
|---|---|
| `formula` | the Dentaku formula string, verbatim from the Ruby spec suite |
| `vars` | variable context passed to `evaluate!` (JSON object, possibly nested) |
| `result` | encoded Ruby result (see below) |
| `error` | Ruby error class name without namespace (`Dentaku::UnboundVariableError` → `"UnboundVariableError"`) |
| `flags` | optional; `{ "dateLiterals": true }` when Ruby's tokenizer consumed a bare date literal (a `:datetime` token). The TS oracle runner must enable the matching calculator option for these entries, because ADR-0003 tightening 5 flips the default off. |

Result encoding:

| Ruby value | encoding |
|---|---|
| `BigDecimal` / `Integer` / `Float` / terminating `Rational` | `{ "type": "decimal", "value": "<exact decimal string>" }` (trailing fractional zeros trimmed) |
| `String` | `{ "type": "string", "value": "..." }` |
| `true` / `false` | `{ "type": "boolean", "value": true\|false }` |
| `nil` | `{ "type": "null" }` |
| `Date` / `DateTime` / `Time` | `{ "type": "datetime", "value": "<ISO 8601, UTC>" }` |
| `Array` | `{ "type": "array", "items": [...] }` (recursive) |
| `Hash` (from enum functions over objects) | `{ "type": "object", "entries": { key: ... } }` (recursive) |

## allowlist.json schema

The divergence allowlist: corpus entries where dentaku-ts intentionally differs, each traceable to an ADR clause. The file is an object with a self-describing `entrySchema` and an `entries` array sorted like the corpus:

```json
{ "formula": "a/b", "vars": { "a": "10", "b": "2" }, "reason": "ADR-0003.3", "expected": "TypeMismatchError", "note": "..." }
```

- `(formula, vars)` must identify an existing corpus entry exactly.
- `reason` is `"ADR-0003.1"`…`"ADR-0003.5"` or `"ADR-0004"`.
- `expected` is the TS-side outcome: a TS error class name, or an encoded result object (same encoding as corpus results).

The oracle runner (issue 014) asserts `expected` for listed entries, fails on any unlisted mismatch, and fails on any listed entry that stops diverging (stale allowlist).

### Seeding notes (issue 002)

17 seed entries: 2×ADR-0003.1 (downcased identifiers), 6×ADR-0003.2 (Ruby nil-truthiness in `IF`/`AND`/`OR`/`NOT`), 6×ADR-0003.3 (string→number coercion in arithmetic/negation), 3×ADR-0004 (eval-time string→date coercion). Issue 014 completes the list.

Two tightenings have **no** seed entries, by measurement of the corpus rather than omission:

- **ADR-0003.4 (bitwise precedence)** — no corpus formula mixes `| & << >>` with comparators unparenthesized; every bitwise formula (`2 | 3 * 9`, `2 & 3 * 9`, `1 << 3`, `0xFF >> 6`, `(5 | 2) + 1`, …) evaluates to the same value under Ruby's precedence-0 quirk and conventional precedence.
- **ADR-0003.5 (bare date literals)** — the 24 affected entries carry `flags.dateLiterals` and the runner enables the option, reproducing Ruby's behavior for exactly those entries; no per-entry divergence remains to allowlist.

Error-class-only differences (e.g. Ruby `Dentaku::ArgumentError` where TS throws `TypeMismatchError`) are not allowlisted: the runner's Ruby→TS error mapping table (issue 014) absorbs them.
