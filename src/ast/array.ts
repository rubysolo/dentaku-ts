// Array literal node `{1, 2, 3}` (Ruby ast/array.rb lineage).
import type { Value } from "../values.js";
import type { EvalContext, Node } from "./node.js";
import { unionDependencies } from "./operands.js";

export class ArrayNode implements Node {
  readonly elements: readonly Node[];
  readonly type = "list";

  constructor(elements: readonly Node[]) {
    this.elements = elements;
  }

  value(ctx: EvalContext): Value[] {
    return this.elements.map((el) => el.value(ctx));
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies(this.elements, ctx);
  }
}
