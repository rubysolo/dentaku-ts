// Bitwise nodes `| & << >>` (Ruby ast/bitwise.rb lineage).
//
// ADR-0003.4: conventional precedence (rows 15/12/11 of the successor table;
// Ruby had these at precedence 0, below comparators). Operands must be
// integral Decimals; the operation runs on BigInt so arbitrarily large
// integers stay exact.
import { Decimal } from "../decimal.js";
import { TypeMismatchError } from "../errors.js";
import type { OperatorValue } from "../tokenizer/token.js";
import { type Value, valueType } from "../values.js";
import type { EvalContext, Node } from "./node.js";
import { unionDependencies } from "./operands.js";

export type BitwiseOp = Extract<OperatorValue, "bitor" | "bitand" | "shiftleft" | "shiftright">;

const DISPLAY: Readonly<Record<BitwiseOp, string>> = {
  bitor: "|",
  bitand: "&",
  shiftleft: "<<",
  shiftright: ">>",
};

function toBigInt(v: Value, what: string): bigint {
  // ADR-0003.4: bitwise operands must be integral Decimals.
  if (!(v instanceof Decimal) || !v.isInteger()) {
    throw new TypeMismatchError(`'${what}' requires integer operands, got ${valueType(v)}`);
  }
  return BigInt(v.toFixed());
}

export class BitwiseNode implements Node {
  readonly op: BitwiseOp;
  readonly left: Node;
  readonly right: Node;
  readonly type = "numeric";

  constructor(op: BitwiseOp, left: Node, right: Node) {
    this.op = op;
    this.left = left;
    this.right = right;
  }

  /** Display form of the operator (for the issue-013 printer). */
  get operator(): string {
    return DISPLAY[this.op];
  }

  value(ctx: EvalContext): Decimal {
    const symbol = DISPLAY[this.op];
    const l = toBigInt(this.left.value(ctx), symbol);
    const r = toBigInt(this.right.value(ctx), symbol);
    let result: bigint;
    switch (this.op) {
      case "bitor":
        result = l | r;
        break;
      case "bitand":
        result = l & r;
        break;
      case "shiftleft":
        result = l << r;
        break;
      case "shiftright":
        result = l >> r;
        break;
    }
    return new Decimal(result.toString());
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies([this.left, this.right], ctx);
  }
}
