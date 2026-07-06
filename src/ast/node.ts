// AST node contract (issue 003 stub, fleshed out by issue 006).
//
// FROZEN signatures: `Node` (value/dependencies/type) and `EvalContext.get`.
// Issue 006 additions below are strictly additive (documented per member).
import type { ReturnType } from "../functions/types.js";
import type { Value } from "../values.js";

/**
 * What an identifier may be bound to in an evaluation context:
 * - a plain `Value` (from `store()` / per-call variables),
 * - a `Node` (from `storeFormula()`), evaluated recursively on lookup,
 * - a zero-argument thunk, called lazily on lookup (Ruby Proc parity).
 *
 * Additive (issue 006): `Value` contains no functions and no objects with
 * function-typed members, so the three arms are disjoint and safely
 * distinguishable at runtime (see `resolveBinding` in scope.ts).
 */
export type Binding = Value | Node | (() => Value);

export interface EvalContext {
  get(name: string): Value | undefined;

  /**
   * Additive (issue 006): raw binding lookup. Unlike `get`, this does NOT
   * resolve `Node`/thunk bindings — `IdentifierNode` needs the raw binding to
   * evaluate stored formulas recursively and call lazy bindings itself.
   * Optional so minimal `EvalContext` implementations (frozen shape) keep
   * working; when absent, callers fall back to `get`.
   */
  lookup?(name: string): Binding | undefined;

  /**
   * Additive (issue 006, consumed by issue 009): strict error mode for enum
   * functions. Absent means `false`.
   */
  readonly strict?: boolean;

  /**
   * Additive (issue 006, consumed by issue 009): cheap layered child scope —
   * the returned context resolves `bindings` first and falls back to this
   * context (used for enum-function lambda parameters, e.g. `map(items, x, x*2)`).
   * Optional; `childScope` in scope.ts works over any `EvalContext`.
   */
  child?(bindings: ReadonlyMap<string, Binding>): EvalContext;
}

export interface Node {
  value(ctx: EvalContext): Value;
  dependencies(ctx?: EvalContext): string[];
  type: ReturnType | null;
}

/**
 * Runtime guard for `Node` within a `Binding`. Sound: `Value` cannot carry
 * function-typed members (numbers become Decimal, functions are rejected at
 * the boundary), so only genuine nodes match.
 */
export function isNode(b: Binding): b is Node {
  return (
    typeof b === "object" &&
    b !== null &&
    typeof (b as { value?: unknown }).value === "function" &&
    typeof (b as { dependencies?: unknown }).dependencies === "function"
  );
}
