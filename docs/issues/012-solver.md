# 012: Bulk solver and dependency resolution

**Depends on**: 011 · **Blocks**: 014
**Owns**: `src/solver/` (dependency-graph.ts, bulk-solver.ts); adds `solve`/`trySolve` methods to `src/calculator.ts` (coordinate: this issue may edit calculator.ts only to add these two methods)

## Context

Ruby `BulkExpressionSolver` + `DependencyResolver` (TSort). Successor improvements per PLAN.md: `trySolve` returns per-key errors instead of `:undefined`; cycles fail only their members and downstream dependents, not the whole batch.

## Deliverables

- `dependency-graph.ts`: build graph from `{name: formula}` (deps via `calculator.dependencies`, scoped to names in the batch — external names must already be satisfiable from memory/vars or the key errors with `UnboundVariableError`); Kahn/Tarjan toposort returning order + strongly-connected components for cycle membership.
- `bulk-solver.ts`: flatten nested input keys (dotted, Ruby parity); facts (formulas with no in-batch deps) evaluated first; then dependency order, storing each result into a scratch context (never the calculator's real memory — no side effects on the instance); self-reference allowed when the name already has a memory value (Ruby parity: `x: "x + 1"` with stored x).
- `calc.solve(formulas, vars?)` → `Record<string, ExternalValue>` (nested keys re-expanded), throws first `DentakuError` (tagged with `key`), `CycleError` for cycles.
- `calc.trySolve(formulas, vars?)` → `{ values: Record<string, ExternalValue>, errors: Record<string, DentakuError> }`: cycle members + downstream dependents get `CycleError`/the causing error; independent keys still solve. Every input key appears in exactly one of the two maps.

## Acceptance criteria

- Port `spec/bulk_expression_solver_spec.rb` and `spec/dependency_resolver_spec.rb`, mapping `:undefined` expectations to `errors` entries (annotate: successor API, PLAN.md "Additions"), and `TSort::Cyclic` expectations to `CycleError`.
- New tests: partial-cycle batch (`a→b→a`, plus independent `c`) — c solves, a and b in errors; error cause preserved per key (ZeroDivisionError on the right key); nested result keys round-trip.
- Green per working agreement.
