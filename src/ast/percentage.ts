// Postfix percentage `50%` (Ruby ast/arithmetic.rb Percentage lineage).
//
// Exact Decimal division by 100 — fixes Ruby's Float leak (`* 0.01`), per
// PLAN.md "Removals": `50% * 2` is exactly 1.

import type { Decimal } from "../decimal.js";
import { ParseError } from "../errors.js";
import type { EvalContext, Node } from "./node.js";
import { numericOperandOk, requireDecimal } from "./operands.js";

export class PercentageNode implements Node {
  readonly node: Node;
  readonly type = "numeric";

  constructor(node: Node) {
    this.node = node;
    if (!numericOperandOk(node)) {
      throw new ParseError(
        `percentage requires a numeric operand, got ${node.type}`,
        "node-invalid",
      );
    }
  }

  value(ctx: EvalContext): Decimal {
    return requireDecimal(this.node.value(ctx), "percentage").div(100);
  }

  dependencies(ctx?: EvalContext): string[] {
    return this.node.dependencies(ctx);
  }
}
