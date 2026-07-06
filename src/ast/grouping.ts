// Transparent grouping wrapper (Ruby ast/grouping.rb lineage).
//
// Like Ruby, the parser treats `(` as an operator-stack marker and never wraps
// output in a Grouping node — parenthesization is re-derived from precedence
// by the printer (issue 013). The class exists for API completeness and tests.
import type { ReturnType } from "../functions/types.js";
import type { Value } from "../values.js";
import type { EvalContext, Node } from "./node.js";

export class GroupingNode implements Node {
  readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  get type(): ReturnType | null {
    return this.node.type;
  }

  value(ctx: EvalContext): Value {
    return this.node.value(ctx);
  }

  dependencies(ctx?: EvalContext): string[] {
    return this.node.dependencies(ctx);
  }
}
