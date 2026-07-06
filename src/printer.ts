// Formula printer (issue 013): AST → canonical infix text, ported from Ruby
// dentaku's print_visitor.rb.
//
// The printed text always re-parses to a structurally equal AST (the
// round-trip property in tests/roundtrip.spec.ts). Parenthesization is
// re-derived from the successor precedence table (src/parser/precedence.ts):
// a child *operation* is parenthesized when its precedence is lower than the
// enclosing operation's, or equal to it on the right-hand side (all binary
// operators are left-associative). Everything else is canonical form, not the
// source text — numeric literals print via Decimal (so `3.0` → `3`,
// `0xFF` → `255`), strings are double-quoted, function names are uppercased.
import { AccessNode } from "./ast/access.js";
import { ArithmeticNode } from "./ast/arithmetic.js";
import { ArrayNode } from "./ast/array.js";
import { BitwiseNode } from "./ast/bitwise.js";
import {
  CaseElseNode,
  CaseNode,
  CaseSwitchVariableNode,
  CaseThenNode,
  CaseWhenNode,
} from "./ast/case.js";
import { CombinatorNode } from "./ast/combinators.js";
import { ComparatorNode } from "./ast/comparators.js";
import { FunctionCallNode } from "./ast/function-node.js";
import { GroupingNode } from "./ast/grouping.js";
import { IdentifierNode } from "./ast/identifier.js";
import { DatetimeNode, LogicalNode, NumericNode, StringNode } from "./ast/literal.js";
import { NegationNode } from "./ast/negation.js";
import { NilNode } from "./ast/nil.js";
import type { Node } from "./ast/node.js";
import { PercentageNode } from "./ast/percentage.js";
import { PRECEDENCE } from "./parser/precedence.js";

/** Binary operation nodes that print as `left OP right` with ` ` spacing. */
type BinaryOperationNode = ArithmeticNode | BitwiseNode | ComparatorNode | CombinatorNode;

function isBinaryOperation(node: Node): node is BinaryOperationNode {
  return (
    node instanceof ArithmeticNode ||
    node instanceof BitwiseNode ||
    node instanceof ComparatorNode ||
    node instanceof CombinatorNode
  );
}

/**
 * Precedence of an *operation* node (Ruby `Dentaku::AST::Operation` lineage:
 * binary operators plus unary negation and postfix percentage); null for
 * non-operations, which never need precedence parentheses.
 */
function operationPrecedence(node: Node): number | null {
  if (isBinaryOperation(node)) {
    return PRECEDENCE[node.op];
  }
  if (node instanceof NegationNode) {
    return PRECEDENCE.negate;
  }
  if (node instanceof PercentageNode) {
    return PRECEDENCE.percentage;
  }
  return null;
}

/**
 * Ruby PrintVisitor#should_output?: parenthesize a child operation whose
 * precedence is lower than the parent's, or equal to it in right-hand
 * position (every binary operator is left-associative, so an equal-precedence
 * right child only exists because the source had explicit parentheses).
 */
function operand(node: Node, parentPrecedence: number, rightSide = false): string {
  const precedence = operationPrecedence(node);
  const parenthesize =
    precedence !== null &&
    (precedence < parentPrecedence || (rightSide && precedence === parentPrecedence));
  return parenthesize ? `(${print(node)})` : print(node);
}

/** Literal nodes in the Ruby sense (Dentaku::AST::Literal subclasses). */
function isLiteral(node: Node): boolean {
  return (
    node instanceof NumericNode ||
    node instanceof StringNode ||
    node instanceof LogicalNode ||
    node instanceof DatetimeNode
  );
}

/**
 * Dentaku strings have no escape sequences (a quote character cannot appear
 * inside a same-quoted string), so a literal containing `"` cannot be printed
 * in the canonical double-quoted form and re-parsed — it is unprintable.
 */
function quoteString(value: string): string {
  if (value.includes('"')) {
    throw new TypeError(
      `unprintable string literal ${JSON.stringify(value)}: dentaku has no escape ` +
        'sequences, so an embedded `"` cannot round-trip through double quotes',
    );
  }
  return `"${value}"`;
}

/**
 * Plain `[\w.]+` identifiers print verbatim; anything else (spaces,
 * punctuation — Ruby's quoted-identifier scanner) is backtick-quoted.
 * A name containing a backtick cannot be quoted and is unprintable.
 */
function printIdentifier(name: string): string {
  if (/^[\w.]+$/.test(name)) {
    return name;
  }
  if (name.includes("`")) {
    throw new TypeError(
      `unprintable identifier ${JSON.stringify(name)}: a backtick cannot appear ` +
        "inside a backtick-quoted identifier",
    );
  }
  return `\`${name}\``;
}

function printCase(node: CaseNode): string {
  let out = `CASE ${print(node.switch.node)}`;
  for (const condition of node.conditions) {
    out += ` WHEN ${print(condition.when.node)} THEN ${print(condition.thenClause.node)}`;
  }
  if (node.else !== null) {
    out += ` ELSE ${print(node.else.node)}`;
  }
  return `${out} END`;
}

/**
 * Prints an AST as canonical dentaku formula text (Ruby
 * `Dentaku::PrintVisitor` parity, with parentheses re-derived from the
 * successor precedence table). Pure function — no calculator involved; the
 * `calc.print(astOrFormula)` wiring lands with issue 011.
 */
export function print(node: Node): string {
  if (node instanceof NumericNode) {
    return node.literal.toString();
  }
  if (node instanceof StringNode) {
    return quoteString(node.literal);
  }
  if (node instanceof LogicalNode) {
    return node.literal ? "true" : "false";
  }
  if (node instanceof DatetimeNode) {
    return node.literal.toISO();
  }
  if (node instanceof NilNode) {
    return "NULL";
  }
  if (node instanceof IdentifierNode) {
    return printIdentifier(node.identifier);
  }
  if (isBinaryOperation(node)) {
    const precedence = PRECEDENCE[node.op];
    return `${operand(node.left, precedence)} ${node.operator} ${operand(node.right, precedence, true)}`;
  }
  if (node instanceof NegationNode) {
    // Ruby visit_negation: literals stay bare (`-4`); anything else is
    // wrapped so the operand cannot rebind (`-(a + b)`, `-(a)`).
    return isLiteral(node.node) ? `-${print(node.node)}` : `-(${print(node.node)})`;
  }
  if (node instanceof PercentageNode) {
    // Postfix `%` with no spacing (Ruby Percentage#operator_spacing is "").
    return `${operand(node.node, PRECEDENCE.percentage)}%`;
  }
  if (node instanceof FunctionCallNode) {
    return `${node.name.toUpperCase()}(${node.args.map(print).join(", ")})`;
  }
  if (node instanceof CaseNode) {
    return printCase(node);
  }
  if (node instanceof AccessNode) {
    return `${print(node.structure)}[${print(node.index)}]`;
  }
  if (node instanceof ArrayNode) {
    return `{${node.elements.map(print).join(", ")}}`;
  }
  if (node instanceof GroupingNode) {
    // The parser never emits GroupingNode (parens are re-derived from
    // precedence), but hand-built ASTs may: print it as explicit parens.
    return `(${print(node.node)})`;
  }
  if (
    node instanceof CaseSwitchVariableNode ||
    node instanceof CaseWhenNode ||
    node instanceof CaseThenNode ||
    node instanceof CaseElseNode
  ) {
    // Transparent CASE assembly wrappers, unreachable inside a well-formed
    // CaseNode (printCase unwraps them) but printable standalone.
    return print(node.node);
  }
  throw new TypeError(`cannot print AST node of type ${node.constructor.name}`);
}
