# 003: Foundation — values, errors, decimal config, function contracts

**Depends on**: 001 · **Blocks**: 004, 005, 006 and transitively everything
**Owns**: `src/values.ts`, `src/errors.ts`, `src/decimal.ts`, `src/data/flatten.ts`, `src/functions/types.ts`, `src/functions/registry.ts`, `src/functions/{logic,numeric,string,collection,date,math}.ts` (as stubs), `src/functions/builtins.ts`, `src/index.ts`

This issue defines the **frozen contracts** every other issue implements against. Precision here saves every downstream agent.

## Deliverables

### `src/decimal.ts`
Re-export `Decimal` from decimal.js, configured once: `precision: 20`, `rounding: ROUND_HALF_UP`. All internal code imports Decimal from here, never from decimal.js directly (Biome rule or lint check if cheap).

### `src/values.ts` — CONTRACT
```ts
type Value = Decimal | string | boolean | null | CivilDateTime | Duration | Value[] | { readonly [k: string]: Value }
type ExternalValue = number | bigint | string | boolean | null | Date | ExternalValue[] | { [k: string]: ExternalValue }
toInternal(v: ExternalValue): Value        // number→Decimal (reject NaN/±Infinity with TypeMismatchError), Date→CivilDateTime
toExternal(v: Value): ExternalValue        // Decimal→number, CivilDateTime→Date; identity otherwise
valueType(v: Value): 'numeric'|'string'|'logical'|'null'|'datetime'|'duration'|'array'|'object'
```
`CivilDateTime` and `Duration` are declared here as interfaces (fields only); issue 004 provides the classes. Fields: CivilDateTime `{year, month, day, hour, minute, second, millisecond}`; Duration `{value: number, unit: 'year'|'month'|'day'}`.

### `src/errors.ts` — CONTRACT
Per PLAN.md taxonomy: `DentakuError` (abstract base; fields `formula?: string`, `key?: string`) ← `ParseError` (fields `reason: string`, `position?: number`; covers tokenizer + parser failures), `UnboundVariableError` (`unboundVariables: string[]`), `TypeMismatchError`, `ArgumentCountError`, `ZeroDivisionError`, `MathDomainError`, `CycleError` (`cycle: string[]`). All carry human-readable messages.

### `src/data/flatten.ts`
`flatten(obj, {intermediates: boolean}): Map<string, Value>` — dot-separated nested-key flattening, with intermediate objects also stored under their dotted key when `intermediates` (Ruby `FlatHash.from_hash_with_intermediates`). `expand(map): object` reverses it (used by solver for nested result keys).

### `src/functions/types.ts` + `registry.ts` — CONTRACT
```ts
type ReturnType = 'numeric'|'string'|'logical'|'list'|'duration'|'datetime'|'any'
interface FunctionDef {
  name: string                    // stored/looked up lowercased (function names are case-insensitive)
  returnType: ReturnType
  fn?: (...args: Value[]) => Value                                   // eager form (public API)
  rawFn?: (argNodes: Node[], ctx: EvalContext) => Value              // special forms (internal: if, map, filter, all, any, reduce)
  minArgs?: number                // default: fn.length
  maxArgs?: number | 'variadic'   // default: fn.length
  checkArgs?: (argNodes: Node[]) => void   // parse-time validation hook (e.g. enum fns require identifier at position 1)
}
class FunctionRegistry { get(name): FunctionDef | undefined; add(def): void; /* seeded from a FunctionSet */ }
class FunctionSet     { /* immutable, shareable collection of FunctionDefs; withFunction(def): FunctionSet */ }
```
`Node` and `EvalContext` are imported as types from `../ast/node.js` — create a minimal `src/ast/node.ts` **type-only stub** here (interface `Node { value(ctx: EvalContext): Value; dependencies(ctx?: EvalContext): string[]; type: ReturnType | null }`, `interface EvalContext { get(name): Value | undefined; ... }`); issue 006 owns fleshing out `src/ast/` but must keep these signatures.

### Function pack stubs
`src/functions/{logic,numeric,string,collection,date,math}.ts` each export `export const <pack>Functions: FunctionDef[] = []` (empty). `src/functions/builtins.ts` imports all six and exports `defaultFunctionSet`. Packs (issues 007–010) fill **only their own file** — no barrel edits, no merge conflicts.

### `src/index.ts`
Export errors, Value/ExternalValue types, FunctionDef/FunctionSet, Decimal.

## Acceptance criteria

- Unit tests for: toInternal/toExternal round-trips (incl. NaN/Infinity rejection), valueType, flatten/expand (nested, intermediates, dotted-key round-trip, non-object leaves), registry add/get case-insensitivity, FunctionSet immutability.
- Everything exported compiles under strict mode; no `any` in contract signatures.
- Green per working agreement.
