# 004: Civil date-time and duration value types

**Depends on**: 003 · **Blocks**: 006, 010
**Owns**: `src/civil-date.ts`

## Context

ADR-0004: internal timezone-free civil date-time; Ruby `Date#>>` month-shift semantics with end-of-month clamping. No JS `Date` internally; no Temporal.

## Deliverables

`CivilDateTime` class (implements the interface declared in `src/values.ts`):
- Construction: `CivilDateTime.of(y, m, d, h=0, min=0, s=0, ms=0)` with validation (real calendar dates; leap years); `CivilDateTime.parseISO(str)` accepting `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS(.sss)?`, space separator variant, optional `Z`/`±HH:MM` offset (offset is normalized to the equivalent civil time in UTC then discarded — document this); `fromDate(d: Date)` (uses the Date's UTC fields); `toDate(): Date` (UTC).
- Arithmetic: `addDays(n)`, `addMonths(n)` (clamp: Jan 31 + 1 month = Feb 28/29), `addYears(n)` (= addMonths(12n)), `diffDays(other): Decimal` (fractional days when time-of-day differs, matching Ruby DateTime subtraction).
- Comparison: `compare(other): -1|0|1`; equality.
- `toISO(): string` — date-only form when time is midnight, full form otherwise.

`Duration` class: `{value, unit}` with unit ∈ year|month|day; `negate()`. Unit normalization from formula text (`year(s)`, `month(s)`, `day(s)`, case-insensitive) lives here as `Duration.parseUnit(raw)` → throws `TypeMismatchError` on unknown units.

`applyDuration(base: CivilDateTime, d: Duration, sign: 1|-1): CivilDateTime`.

## Acceptance criteria

- Tests pinning Ruby semantics: `2020-01-31 + 1 month → 2020-02-29`; `2019-01-31 + 1 month → 2019-02-28`; `2020-02-29 + 1 year → 2021-02-28`; date − date fractional days; ISO parse/format round-trips; offset normalization.
- No `Date` usage except in `fromDate`/`toDate`.
- Green per working agreement.
