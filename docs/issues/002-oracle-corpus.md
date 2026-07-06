# 002: Oracle corpus generation (Ruby side)

**Depends on**: 001 · **Blocks**: 014
**Owns**: `scripts/extract-corpus.rb`, `scripts/generate-oracle.rb`, `tests/oracle/corpus.json`, `tests/oracle/allowlist.json`

## Context

PLAN.md "Verification protocol". The oracle corpus is the AFK honesty mechanism: dentaku-ts must reproduce Ruby dentaku 3.5.7's results exactly, minus an enumerated divergence allowlist (see CONTEXT.md definitions). This issue produces the committed golden data; CI never runs Ruby.

## Deliverables

- `scripts/extract-corpus.rb`: clones/uses Ruby dentaku v3.5.7 source, extracts every unique `(formula, variables)` pair exercised by its spec suite (`spec/**/*.rb`) — both literal `evaluate('...')`-style calls and context hashes passed alongside. Target ≈400 unique formulas. Where a spec supplies variables, capture them; where it registers custom functions, skip the case and log it (custom-function cases are covered by translated specs, not the oracle).
- `scripts/generate-oracle.rb`: runs the gem (`ruby -Ilib`) over each pair inside a rescue harness; emits `tests/oracle/corpus.json`, an array of entries:
  ```json
  { "formula": "5 / 2", "vars": {}, "result": { "type": "decimal", "value": "2.5" } }
  { "formula": "10 * x", "vars": {}, "error": "UnboundVariableError" }
  ```
  Result encoding: BigDecimal/Integer → `{type:"decimal", value:"<exact decimal string>"}`; String → `{type:"string"}`; true/false → `{type:"boolean"}`; nil → `{type:"null"}`; Date/DateTime → `{type:"datetime", value:"<ISO 8601>"}`; Array → `{type:"array", items:[...]}` recursively. Errors recorded by Ruby class name.
- Entries where the tokenizer consumed a bare date literal get `"flags": {"dateLiterals": true}` so the TS runner enables the matching calculator option (ADR-0003 tightening 5 flips the default).
- `tests/oracle/allowlist.json`: schema + seed entries. Each entry: `{ "formula", "vars"?, "reason": "ADR-0003.1"…"ADR-0003.5" | "ADR-0004", "expected": <TS-side result or error name> }`. Seed it with the corpus entries that obviously hit the five tightenings (e.g. formulas relying on Ruby truthiness, string coercion, bitwise precedence, downcased identifiers, bare date literals); issue 014 completes it.
- A short `tests/oracle/README.md` documenting the schema and the regeneration command.

## Acceptance criteria

- `corpus.json` committed, ≥350 entries, valid JSON, deterministic ordering (sorted by formula) so regeneration diffs cleanly.
- Every corpus entry has exactly one of `result` / `error`.
- Spot-check documented in the issue's closing note: `5 / 2` → decimal 2.5; `0.1 + 0.2 == 0.3` present and true; at least one UnboundVariableError and one ZeroDivisionError entry.
- No TS code touched.
