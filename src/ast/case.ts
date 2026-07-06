// CASE expression (Ruby ast/case.rb + ast/case/* lineage).
//
// The parser assembles CASE innermost-first via the wrapper nodes below
// (switch variable, WHEN, THEN, ELSE, WHEN/THEN conditional); CaseNode
// validates the assembly exactly like Ruby (missing switch variable,
// non-conditional argument) and unwraps it for evaluation.
import { ParseError } from "../errors.js";
import type { Value } from "../values.js";
import { looseEquals } from "./equality.js";
import type { EvalContext, Node } from "./node.js";
import { unionDependencies } from "./operands.js";

/** Transparent single-child wrapper used by the CASE assembly. */
abstract class CaseWrapperNode implements Node {
  readonly node: Node;
  readonly type = null;

  constructor(node: Node) {
    this.node = node;
  }

  value(ctx: EvalContext): Value {
    return this.node.value(ctx);
  }

  dependencies(ctx?: EvalContext): string[] {
    return this.node.dependencies(ctx);
  }
}

export class CaseSwitchVariableNode extends CaseWrapperNode {}
export class CaseWhenNode extends CaseWrapperNode {}
export class CaseThenNode extends CaseWrapperNode {}
export class CaseElseNode extends CaseWrapperNode {}

/** One WHEN/THEN pair. */
export class CaseConditionalNode implements Node {
  readonly when: CaseWhenNode;
  readonly thenClause: CaseThenNode;
  readonly type = null;

  constructor(whenNode: Node, thenNode: Node) {
    if (!(whenNode instanceof CaseWhenNode)) {
      throw new ParseError("Expected first argument to be a CaseWhen", "node-invalid");
    }
    if (!(thenNode instanceof CaseThenNode)) {
      throw new ParseError("Expected second argument to be a CaseThen", "node-invalid");
    }
    this.when = whenNode;
    this.thenClause = thenNode;
  }

  value(ctx: EvalContext): Value {
    return this.thenClause.value(ctx);
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies([this.when, this.thenClause], ctx);
  }
}

export class CaseNode implements Node {
  readonly switch: CaseSwitchVariableNode;
  readonly conditions: readonly CaseConditionalNode[];
  readonly else: CaseElseNode | null;
  readonly type = null;

  constructor(nodes: readonly Node[]) {
    const [switchNode, ...rest] = nodes;
    if (!(switchNode instanceof CaseSwitchVariableNode)) {
      throw new ParseError("Case missing switch variable", "node-invalid");
    }
    this.switch = switchNode;
    this.else = rest[rest.length - 1] instanceof CaseElseNode ? (rest.pop() as CaseElseNode) : null;
    for (const condition of rest) {
      if (!(condition instanceof CaseConditionalNode)) {
        throw new ParseError("Case argument is not a CaseConditional", "node-invalid");
      }
    }
    this.conditions = rest as CaseConditionalNode[];
  }

  /**
   * WHEN values match the switch value by non-throwing equality (mixed types
   * answer false, Ruby `==` parity). No match and no ELSE → null — a spec'd
   * deviation from Ruby, which raised (docs/issues/006: "no match + no else
   * → null").
   */
  value(ctx: EvalContext): Value {
    const switchValue = this.switch.value(ctx);
    for (const condition of this.conditions) {
      if (looseEquals(condition.when.value(ctx), switchValue)) {
        return condition.thenClause.value(ctx);
      }
    }
    return this.else === null ? null : this.else.value(ctx);
  }

  dependencies(ctx?: EvalContext): string[] {
    const children: Node[] = [this.switch, ...this.conditions];
    if (this.else !== null) {
      children.push(this.else);
    }
    return unionDependencies(children, ctx);
  }
}
