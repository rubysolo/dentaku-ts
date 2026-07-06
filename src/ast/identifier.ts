// Identifier node (Ruby ast/identifier.rb lineage).
//
// Case normalization happens in the tokenizer (ADR-0003.1: case-sensitive by
// default; `caseInsensitiveIdentifiers` downcases there) — this node uses the
// token value verbatim.
import { UnboundVariableError } from "../errors.js";
import type { Value } from "../values.js";
import { type Binding, type EvalContext, isNode, type Node } from "./node.js";
import { resolveBinding } from "./scope.js";

function rawBinding(ctx: EvalContext, name: string): Binding | undefined {
  return ctx.lookup !== undefined ? ctx.lookup(name) : ctx.get(name);
}

export class IdentifierNode implements Node {
  readonly identifier: string;
  readonly type = null;

  constructor(identifier: string) {
    this.identifier = identifier;
  }

  /**
   * Unbound → UnboundVariableError. A Node binding (from `storeFormula`)
   * evaluates recursively; a thunk binding is called lazily (Ruby Proc parity).
   */
  value(ctx: EvalContext): Value {
    const binding = rawBinding(ctx, this.identifier);
    if (binding === undefined) {
      throw new UnboundVariableError(`no value provided for variables: ${this.identifier}`, [
        this.identifier,
      ]);
    }
    return resolveBinding(binding, ctx);
  }

  /**
   * Contributes its own name when unbound; a Node binding contributes that
   * node's dependencies (Ruby parity); any other binding contributes nothing.
   */
  dependencies(ctx?: EvalContext): string[] {
    const binding = ctx === undefined ? undefined : rawBinding(ctx, this.identifier);
    if (binding === undefined) {
      return [this.identifier];
    }
    return typeof binding !== "function" && isNode(binding) ? binding.dependencies(ctx) : [];
  }
}
