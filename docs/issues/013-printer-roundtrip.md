# 013: Formula printer and round-trip suite

**Depends on**: 006 · **Blocks**: 014 · **Parallel with**: 007–010
**Owns**: `src/printer.ts`, `tests/roundtrip.spec.ts`

## Deliverables

- `print(node: Node): string` — canonical infix reconstruction per Ruby `print_visitor.rb`: parenthesize a child operation when its precedence is lower than the parent's, or equal-and-right-side; `^` for pow, `=` for equality, ` ` spacing for binary ops, no spacing for postfix `%`; `NAME(arg, arg)` uppercase function names; `CASE … WHEN … THEN … [ELSE …] END`; unary minus wraps non-literal operands in parens; string literals double-quoted (escape embedded quotes on output only — input has no escapes, so escaped output must simply re-parse or the literal is flagged unprintable); `NULL` for null; `{a, b}` arrays; backtick-quoting for identifiers that aren't plain `[\w.]+`.
- Exported as `calc.print(astOrFormula)` — pure function in `printer.ts`; the calculator method wiring lands in 011/this issue's test uses the pure function directly (no calculator dependency).
- `tests/roundtrip.spec.ts`: for every entry in `tests/oracle/corpus.json` that parses, assert `parse(print(parse(f)))` produces a structurally equal AST (write a deep-equal helper over node kind + children + literal values). Skip-list any corpus formulas that legitimately can't round-trip, each with a reason comment.

## Acceptance criteria

- Port `spec/print_visitor_spec.rb` (includes the precedence-parenthesization and percentage regressions fixed in Ruby 3.5.2/3.5.5 — keep those cases).
- Round-trip suite green over the corpus with a skip-list of ≤5 entries.
- Green per working agreement.
