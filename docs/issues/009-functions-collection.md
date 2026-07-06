# 009: Function pack — collection (enum special forms)

**Depends on**: 006 · **Blocks**: 011 · **Parallel with**: 007, 008, 010, 013
**Owns**: `src/functions/collection.ts`

## Context

These are the identifier-lambda special forms (PLAN.md: identifier form only in v1): `map(items, x, x * 2)` — arg 1 must be an Identifier node, enforced at parse time via `checkArgs` (Ruby raises "requires second argument to be an identifier"). Reference `lib/dentaku/ast/functions/enum.rb` and subclasses.

## Deliverables

All are `rawFn` special forms:
- Collection argument: evaluate arg 0; null → empty array; scalar → 1-element array (Ruby `Array()` semantics); arrays pass through.
- Item binding: for each element, evaluate the body expression in a child EvalContext where the identifier name is bound to the element — **and, when the element is an object, its flattened dotted keys with intermediates are bound under `ident.…`** (Ruby merges `FlatHash.from_hash_with_intermediates(ident => item)`), so `map(users, u, u.age)` works.
- Error mode: in permissive evaluation (`tryEvaluate`/`trySolve`), a per-item error yields null for that item in `map`; in strict mode it propagates (Ruby `__evaluation_mode` behavior). `filter`/`all`/`any` bodies must produce booleans (**ADR-0003.2**).
- `map`, `filter`, `all`, `any` (3 args); `pluck(collection, key, default?)` — collection must be array of objects (`TypeMismatchError` otherwise), missing key → default (or null); `reduce(collection, memo, item, expr, initial?)` — args 1 and 2 Identifiers, initial defaults to null, body evaluated with both bindings.
- `dependencies` subtracts the bound identifier(s) and their dotted prefixes from the body's deps (Ruby parity — critical for the solver).

## Acceptance criteria

- Port `spec/ast/{map,filter,all,any,pluck,reduce}_spec.rb`; ADR-annotate deviations.
- Dependency tests: `dependencies("map(xs, x, x * rate)")` → `["xs", "rate"]`.
- Shadowing test: outer variable `x` restored after enum evaluation.
- Green per working agreement.
