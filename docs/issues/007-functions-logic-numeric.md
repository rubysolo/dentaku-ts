# 007: Function pack — logic and numeric

**Depends on**: 006 · **Blocks**: 011 · **Parallel with**: 008, 009, 010, 013
**Owns**: `src/functions/logic.ts`, `src/functions/numeric.ts` (fill the 003 stubs; touch no other src file)

## Deliverables

**Logic** (`logicFunctions`):
- `if(pred, a, b)` — special form (`rawFn`): evaluate predicate, require boolean (**ADR-0003.2**), lazily evaluate only the taken branch. `dependencies` may short-circuit like Ruby's (evaluate predicate if possible, else union).
- `and(...)`, `or(...)` — eager, ≥1 arg, every arg must be boolean or null (null ⇒ false, Ruby parity), else `TypeMismatchError`; return all/any.
- `xor(...)` — ≥1 boolean/null args, true iff exactly one true.
- `not(x)` — 1 boolean arg.
- `switch(v, k1, r1, ..., default?)` — pairs matched by equality, odd trailing arg = default, no match → null.

**Numeric** (`numericFunctions`): `min max sum mul avg count round rounddown roundup abs intercept` with Ruby semantics per PLAN.md "Kept behaviors": flatten nested arrays (min/max/sum/mul/avg); sum/mul/avg require ≥1 arg (`ArgumentCountError`); every element must be numeric (`TypeMismatchError` — no string coercion, ADR-0003.3); `avg` exact Decimal division; `count` = length of single sizable arg else arg count; `round(n, places=0)` half-up; `rounddown`/`roundup` = floor/ceil at precision, exact Decimal (no Float, deviation is internal only — results match Ruby); `intercept(xs, ys)` linear-regression intercept, two equal-length numeric arrays.

## Acceptance criteria

- Port `spec/ast/{and_function,or,xor}_spec.rb` (function forms), `spec/ast/{max,min,sum,mul,avg,count,round,rounddown,roundup,abs,intercept}_spec.rb`, and the IF cases from `spec/ast/function_spec.rb`; ADR-annotate deviations (e.g. `if(1, …)` now TypeMismatchError).
- Formula-level tests run through `parse(tokenize(...))` with the default function set.
- Green per working agreement.
