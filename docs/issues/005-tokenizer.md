# 005: Tokenizer

**Depends on**: 003 · **Blocks**: 006
**Owns**: `src/tokenizer/` (token.ts, scanners.ts, tokenizer.ts, numeric.ts)

## Context

PLAN.md "Kept Ruby behaviors". The Ruby tokenizer's scanner *order* is semantically load-bearing (first match wins) — preserve it exactly. Reference: `lib/dentaku/tokenizer.rb`, `token_scanner.rb`, `numeric_parser.rb` in the gem.

## Deliverables

### Token — CONTRACT (issue 006 consumes this)
```ts
interface Token { category: TokenCategory; value: TokenValue; raw: string; position: number }
type TokenCategory = 'null'|'numeric'|'string'|'operator'|'grouping'|'array'|'access'|'case'|'comparator'|'combinator'|'logical'|'function'|'identifier'|'datetime'
```
Operator values: `add subtract multiply divide pow mod negate bitor bitand shiftleft shiftright`; comparator values: `lt gt le ge ne eq`; combinator: `and or`; grouping: `open close comma`; array: `arrayStart arrayEnd`; access: `lbracket rbracket`; case: `case end when then else`.

### Scanner table, in Ruby's order
null → whitespace (dropped) → *datetime (only when `dateLiterals` option true; regex from Ruby: `/\d{2}\d{2}?-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{1,2}:\d{1,2}(\.\d*)?)? ?(Z|((\+|\-)\d{2}:?\d{2}))?(?!\d)/`, value parsed via `CivilDateTime.parseISO`)* → numeric → hexadecimal → double-quoted string → single-quoted string → negate (unary-minus rule: previous meaningful token is nil, operator, comparator, combinator, `open`, `comma`, `lbracket`, or `arrayStart`) → combinator (`(and|or|&&|\|\|)` requiring trailing whitespace for word forms) → operator → grouping → array → access → case keywords (word-boundary) → comparator (`<= >= != <> < > == =`) → boolean (`true|false\b`) → function (`\w+!?\s*\(` → emits function token + open-grouping token) → identifier (`[\w.]+\b`, **case preserved** — ADR-0003.1; downcase only when calculator option `caseInsensitiveIdentifiers`) → backtick-quoted identifier.

All scanners case-insensitive for their keyword matching (function names, `and/or`, `true/false`, `null`, case keywords) while preserving identifier case.

### Behaviors
- Comment stripping first: `/\* ... \*/` (Ruby regex `\/\*[^*]*\*+(?:[^*\/][^*]*\*+)*\//`), single or multi-line.
- Numeric literals via `numeric.ts`: integer, decimal, leading-dot, scientific, hex (`0x…`) — all produce `Decimal`. No underscores.
- Strings: no escape sequences (regex `"[^"]*"` / `'[^']*'`).
- Paren/bracket/brace balance tracked; imbalance → `ParseError` with reason `unbalanced-parenthesis` etc.; unmatched input → `ParseError` reason `invalid-token` with position.
- Tokenizer entry: `tokenize(formula: string, options: {dateLiterals?: boolean, caseInsensitiveIdentifiers?: boolean}): Token[]`.

## Acceptance criteria

- Port `spec/tokenizer_spec.rb`, `spec/token_spec.rb`, `spec/token_scanner_spec.rb` to `tests/tokenizer.spec.ts`, adjusting only for: identifier case preservation (ADR-0003.1 comment), date literals off by default (ADR-0003.5 — those cases run with `dateLiterals: true`).
- Extra cases: `5%` vs `5 % 2` both tokenize as `mod` (percentage resolution is the parser's job); `2020-1-1` without the flag → numeric/subtract/numeric/subtract/numeric; `a.b.c` is one identifier token.
- Green per working agreement.
