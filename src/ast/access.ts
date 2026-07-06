// Index/key access node `a[expr]` (Ruby ast/access.rb lineage).
import { Decimal } from "../decimal.js";
import { TypeMismatchError } from "../errors.js";
import { type Value, valueType } from "../values.js";
import type { EvalContext, Node } from "./node.js";
import { unionDependencies } from "./operands.js";

export class AccessNode implements Node {
  readonly structure: Node;
  readonly index: Node;
  readonly type = null;

  constructor(structure: Node, index: Node) {
    this.structure = structure;
    this.index = index;
  }

  /**
   * Arrays take an integral index (negative wraps from the end, matching
   * Ruby's `Array#[]`); objects take a string key. Out-of-range / missing
   * key → null (Ruby `[]` returns nil). Anything else → TypeMismatchError.
   */
  value(ctx: EvalContext): Value {
    const structure = this.structure.value(ctx);
    const index = this.index.value(ctx);

    if (Array.isArray(structure)) {
      if (!(index instanceof Decimal) || !index.isInteger()) {
        throw new TypeMismatchError(
          `array access requires an integer index, got ${valueType(index)}`,
        );
      }
      let i = index.toNumber();
      if (i < 0) {
        i += structure.length;
      }
      const element = structure[i];
      return element === undefined ? null : element;
    }

    if (valueType(structure) === "object") {
      if (typeof index !== "string") {
        throw new TypeMismatchError(`object access requires a string key, got ${valueType(index)}`);
      }
      const record = structure as { readonly [k: string]: Value };
      return Object.hasOwn(record, index) ? (record[index] ?? null) : null;
    }

    throw new TypeMismatchError(`cannot index into a ${valueType(structure)}`);
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies([this.structure, this.index], ctx);
  }
}
