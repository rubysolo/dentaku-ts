# 008: Function pack — string

**Depends on**: 006 · **Blocks**: 011 · **Parallel with**: 007, 009, 010, 013
**Owns**: `src/functions/string.ts`

## Deliverables

`stringFunctions`: `left right mid len find substitute concat contains`, Excel-lineage semantics per Ruby `lib/dentaku/ast/functions/string_functions.rb`:

- Arguments stringify via explicit conversion of any Value to its display string (numbers via Decimal `toString`, booleans `true`/`false`, null → empty? — **match Ruby `to_s`: nil → ""**). Length/offset args must be numeric, non-negative → else `TypeMismatchError`/Ruby's `invalid-value` semantics (use `TypeMismatchError` with the Ruby message text).
- `left(s, n)` first n chars (clamps); `right(s, n)` last n (clamps); `mid(s, offset, n)` **1-based** offset; `len(s)`; `find(needle, haystack)` 1-based index or null; `substitute(s, search, replacement)` **first occurrence only**; `concat(...)` ≥1 arg; `contains(needle, haystack)` boolean.
- Unicode: operate on code points (`[...s]`), not UTF-16 units — document; Ruby strings are character-based so this is the parity choice.

## Acceptance criteria

- Port `spec/ast/string_functions_spec.rb` fully (it is table-driven and thorough — include its edge cases: zero lengths, over-long lengths, case sensitivity of `contains`).
- Add astral-plane test (`len("💀💀") = 2`).
- Green per working agreement.
