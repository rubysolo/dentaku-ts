# 010: Function pack — date and math

**Depends on**: 006 (and 004's types) · **Blocks**: 011 · **Parallel with**: 007, 008, 009, 013
**Owns**: `src/functions/date.ts`, `src/functions/math.ts`

## Deliverables

**Date** (`dateFunctions`):
- `date("2026-07-04")` / `date(y, m, d)` — new in dentaku-ts (ADR-0004): string form parses via `CivilDateTime.parseISO` (invalid → `TypeMismatchError` with the offending string); numeric form validates a real calendar date. Returns datetime.
- `duration(value, unit)` — value numeric, unit from an identifier or string token exactly as Ruby accepts it (`duration(1, month)` — the unit arrives as an unbound identifier; use `checkArgs`/`rawFn` to read the identifier's *name* rather than resolving it, Ruby parity), units year/month/day with plural forms, else `TypeMismatchError`.

**Math** (`mathFunctions`) — the pinned float64 list (PLAN.md): `sin cos tan asin acos atan atan2 sinh cosh tanh asinh acosh atanh exp log log2 log10 sqrt cbrt hypot pow`. Each: args → `toNumber()`, JS `Math.*`, result re-wrapped `new Decimal(result)`. A `NaN` result from a domain violation (e.g. `sqrt(-1)`, `log(-1)`, `acos(2)`) → `MathDomainError` (Ruby parity — do not return NaN). `log` is natural log with optional base second arg? — **No**: match Ruby `Math.log(x, base?)` two-arg form. `pow(x, y)` mirrors `^`. Variadic flattening of array args like Ruby (`sum`-style flatten) applies.

## Acceptance criteria

- Tests: each math function against known values (float tolerance where irrational); every domain-error case throws `MathDomainError`; `date()` both forms + invalid inputs; `duration(1, month)` and `duration(2, days)` formula-level; `date("2020-01-31") + duration(1, month)` → 2020-02-29 (via 006's datetime arithmetic).
- Note in the closing comment: `erf erfc gamma lgamma frexp ldexp` intentionally absent (PLAN.md backlog).
- Green per working agreement.
