// Generic function-call node bound to a FunctionDef (issue 006).
//
// Registry lookup, arity validation, and `checkArgs` all run at parse time in
// the parser; this node only dispatches evaluation: eager defs get evaluated
// argument values, special forms (`rawFn`) get the unevaluated argument nodes
// plus the context (issue 007's `if`, issue 009's enum functions).
import type { FunctionDef, ReturnType } from "../functions/types.js";
import type { Value } from "../values.js";
import type { EvalContext, Node } from "./node.js";
import { unionDependencies } from "./operands.js";

export class FunctionCallNode implements Node {
  readonly def: FunctionDef;
  readonly args: readonly Node[];
  readonly type: ReturnType;

  constructor(def: FunctionDef, args: readonly Node[]) {
    if (def.fn === undefined && def.rawFn === undefined) {
      throw new TypeError(`FunctionDef '${def.name}' has neither fn nor rawFn`);
    }
    this.def = def;
    this.args = args;
    this.type = def.returnType;
  }

  /** The registered (lowercased) function name. */
  get name(): string {
    return this.def.name.toLowerCase();
  }

  value(ctx: EvalContext): Value {
    if (this.def.rawFn !== undefined) {
      return this.def.rawFn([...this.args], ctx);
    }
    const fn = this.def.fn as (...args: Value[]) => Value;
    return fn(...this.args.map((arg) => arg.value(ctx)));
  }

  /**
   * Union over the argument nodes. Special forms that need short-circuit or
   * lambda-aware dependency reporting refine this in later issues.
   */
  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies(this.args, ctx);
  }
}
