// Unary minus (Ruby ast/negation.rb lineage). Precedence 50, right-associative,
// binding tighter than `^` (Ruby parity: `-2 ^ 2 = 4`).

import type { Decimal } from "../decimal.js";
import { ParseError } from "../errors.js";
import type { EvalContext, Node } from "./node.js";
import { numericOperandOk, requireDecimal } from "./operands.js";

export class NegationNode implements Node {
  readonly node: Node;
  readonly type = "numeric";

  constructor(node: Node) {
    this.node = node;
    // Ruby parity: statically non-numeric operands are rejected at parse time.
    if (!numericOperandOk(node)) {
      throw new ParseError(`negation requires numeric operands, got ${node.type}`, "node-invalid");
    }
  }

  value(ctx: EvalContext): Decimal {
    // ADR-0003.3: no string→number coercion (Ruby cast '5' to 5 here).
    return requireDecimal(this.node.value(ctx), "negation").neg();
  }

  dependencies(ctx?: EvalContext): string[] {
    return this.node.dependencies(ctx);
  }
}
