// TYPE-ONLY stub for the AST node contract (issue 003). Issue 006 owns fleshing
// out src/ast/ but must keep these exact signatures. No classes or logic here.
import type { ReturnType } from "../functions/types.js";
import type { Value } from "../values.js";

export interface EvalContext {
  get(name: string): Value | undefined;
}

export interface Node {
  value(ctx: EvalContext): Value;
  dependencies(ctx?: EvalContext): string[];
  type: ReturnType | null;
}
