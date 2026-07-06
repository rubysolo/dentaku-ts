// Combinator nodes `and`/`or`/`&&`/`||` (Ruby ast/combinators.rb lineage).
//
// ADR-0003.2 tightening: strict booleans — operands must be boolean, the
// result is boolean, and evaluation short-circuits. No Ruby truthiness
// (where 0 and "" are true) and no operand-value results.
import { ParseError } from "../errors.js";
import type { CombinatorValue } from "../tokenizer/token.js";
import type { EvalContext, Node } from "./node.js";
import { logicalOperandOk, requireBoolean, unionDependencies } from "./operands.js";

export class CombinatorNode implements Node {
  readonly op: CombinatorValue;
  readonly left: Node;
  readonly right: Node;
  readonly type = "logical";

  constructor(op: CombinatorValue, left: Node, right: Node) {
    this.op = op;
    this.left = left;
    this.right = right;
    // Ruby parity: statically non-logical operands are rejected at parse time.
    for (const operand of [left, right]) {
      if (!logicalOperandOk(operand)) {
        throw new ParseError(
          `${op} requires logical operands, got ${operand.type}`,
          "node-invalid",
        );
      }
    }
  }

  /** Display form of the operator (for the issue-013 printer). */
  get operator(): string {
    return this.op;
  }

  value(ctx: EvalContext): boolean {
    const l = requireBoolean(this.left.value(ctx), `'${this.op}'`);
    // ADR-0003.2: short-circuit on a decisive left operand.
    if (this.op === "and" && !l) {
      return false;
    }
    if (this.op === "or" && l) {
      return true;
    }
    return requireBoolean(this.right.value(ctx), `'${this.op}'`);
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies([this.left, this.right], ctx);
  }
}
