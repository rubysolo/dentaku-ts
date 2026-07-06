// Function descriptor contract (frozen; see docs/issues/003-foundation.md).
import type { EvalContext, Node } from "../ast/node.js";
import type { Value } from "../values.js";

export type ReturnType =
  | "numeric"
  | "string"
  | "logical"
  | "list"
  | "duration"
  | "datetime"
  | "any";

export interface FunctionDef {
  /** Stored and looked up lowercased — function names are case-insensitive. */
  name: string;
  returnType: ReturnType;
  /** Eager form (public API): receives evaluated argument values. */
  fn?: (...args: Value[]) => Value;
  /** Special forms (internal: if, map, filter, all, any, reduce): receives unevaluated nodes. */
  rawFn?: (argNodes: Node[], ctx: EvalContext) => Value;
  /** Default: fn.length */
  minArgs?: number;
  /** Default: fn.length */
  maxArgs?: number | "variadic";
  /** Parse-time validation hook (e.g. enum fns require an identifier at position 1). */
  checkArgs?: (argNodes: Node[]) => void;
  /**
   * Dependency reporting override for special forms whose default child-union
   * is wrong: `if` short-circuits through an evaluable predicate (issue 007),
   * enum functions subtract their bound lambda identifiers (issue 009).
   * Additive extension to the frozen contract, signed off during wave 4→5.
   */
  dependencies?: (argNodes: Node[], ctx?: EvalContext) => string[];
}
