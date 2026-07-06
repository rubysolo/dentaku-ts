// Shared operand validation and dependency plumbing for AST nodes (issue 006).
import { Decimal } from "../decimal.js";
import { TypeMismatchError } from "../errors.js";
import type { ReturnType } from "../functions/types.js";
import { type Value, valueType } from "../values.js";
import type { EvalContext, Node } from "./node.js";

/** Ordered union of the children's dependencies (Ruby `uniq` parity). */
export function unionDependencies(nodes: readonly Node[], ctx?: EvalContext): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of nodes) {
    for (const dep of node.dependencies(ctx)) {
      if (!seen.has(dep)) {
        seen.add(dep);
        out.push(dep);
      }
    }
  }
  return out;
}

/**
 * ADR-0003.3: arithmetic and numeric contexts take Decimal operands only —
 * no string→number coercion (Ruby coerced stringly context values at eval time).
 */
export function requireDecimal(v: Value, what: string): Decimal {
  if (v instanceof Decimal) {
    return v;
  }
  throw new TypeMismatchError(`${what} requires a numeric operand, got ${valueType(v)}`);
}

/**
 * ADR-0003.2: combinators and conditionals take boolean operands only —
 * no Ruby truthiness where `0` and `""` are true.
 */
export function requireBoolean(v: Value, what: string): boolean {
  if (typeof v === "boolean") {
    return v;
  }
  throw new TypeMismatchError(`${what} requires a logical operand, got ${valueType(v)}`);
}

// --- Parse-time operand admissibility (Ruby Arithmetic#valid_node? lineage) ---
//
// Ruby validated operand *node types* at construction time: a node is
// admissible when it has unresolved dependencies (an identifier that will be
// bound later), when its type cannot be known statically (null), or when its
// declared type is in the allowed set. dentaku-ts additionally admits `any`
// (function defs can declare it; Ruby function nodes reported a nil type) and
// defers the final say to eval-time checks (ADR-0003.2/3).

function admissible(node: Node, allowed: readonly (ReturnType | null)[]): boolean {
  if (node.type === null || node.type === "any" || allowed.includes(node.type)) {
    return true;
  }
  return node.dependencies().length > 0;
}

/**
 * Ruby parity: numeric and list types are statically admissible in arithmetic
 * (lists so that `{1} + {2}` fails at eval per ADR-0003.3, exactly where
 * Ruby's array concat behavior is tightened away).
 */
export function arithmeticOperandOk(node: Node, extra: readonly ReturnType[] = []): boolean {
  return admissible(node, ["numeric", "list", ...extra]);
}

export function logicalOperandOk(node: Node): boolean {
  return admissible(node, ["logical"]);
}

export function numericOperandOk(node: Node): boolean {
  return admissible(node, ["numeric"]);
}
