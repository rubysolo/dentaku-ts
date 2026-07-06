// Comparator nodes `< <= > >= = == != <>` (Ruby ast/comparators.rb lineage).
//
// ADR-0003.3 tightening: typed pairs only. Ordering works on numeric/numeric
// (Decimal.cmp), string/string (lexicographic), datetime/datetime; equality
// additionally on boolean, null, duration, and deep on arrays/objects. Any
// mixed-type pair throws TypeMismatchError (Ruby coerced numeric strings and
// answered false for mixed `==`).
import type { ComparatorValue } from "../tokenizer/token.js";
import { compareOrdered, strictEquals } from "./equality.js";
import type { EvalContext, Node } from "./node.js";
import { unionDependencies } from "./operands.js";

const DISPLAY: Readonly<Record<ComparatorValue, string>> = {
  lt: "<",
  gt: ">",
  le: "<=",
  ge: ">=",
  ne: "!=",
  eq: "=",
};

export class ComparatorNode implements Node {
  readonly op: ComparatorValue;
  readonly left: Node;
  readonly right: Node;
  readonly type = "logical";

  constructor(op: ComparatorValue, left: Node, right: Node) {
    this.op = op;
    this.left = left;
    this.right = right;
  }

  /** Display form of the operator (for messages and the issue-013 printer). */
  get operator(): string {
    return DISPLAY[this.op];
  }

  value(ctx: EvalContext): boolean {
    const l = this.left.value(ctx);
    const r = this.right.value(ctx);
    switch (this.op) {
      case "eq":
        return strictEquals(l, r);
      case "ne":
        return !strictEquals(l, r);
      case "lt":
        return compareOrdered(l, r) < 0;
      case "gt":
        return compareOrdered(l, r) > 0;
      case "le":
        return compareOrdered(l, r) <= 0;
      case "ge":
        return compareOrdered(l, r) >= 0;
    }
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies([this.left, this.right], ctx);
  }
}
