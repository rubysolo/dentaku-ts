// Token contract (issue 005; frozen — issue 006 consumes this).
// Mirrors Ruby dentaku's Token {category, value, raw_value} plus a `position`
// pointing at the token's offset in the original (pre-comment-stripping) input.
import type { Decimal } from "../decimal.js";
import type { CivilDateTime } from "../values.js";

export type TokenCategory =
  | "null"
  | "numeric"
  | "string"
  | "operator"
  | "grouping"
  | "array"
  | "access"
  | "case"
  | "comparator"
  | "combinator"
  | "logical"
  | "function"
  | "identifier"
  | "datetime";

// Ruby's :bitshiftleft/:bitshiftright are named shiftleft/shiftright here (contract naming).
export type OperatorValue =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "pow"
  | "mod"
  | "negate"
  | "bitor"
  | "bitand"
  | "shiftleft"
  | "shiftright";

export type ComparatorValue = "lt" | "gt" | "le" | "ge" | "ne" | "eq";

export type CombinatorValue = "and" | "or";

export type GroupingValue = "open" | "close" | "comma";

export type ArrayValue = "arrayStart" | "arrayEnd";

export type AccessValue = "lbracket" | "rbracket";

// Ruby maps `case`→:open and `end`→:close; the contract keeps the keywords themselves.
export type CaseValue = "case" | "end" | "when" | "then" | "else";

/**
 * The value carried by a token:
 * - `null` for the null literal
 * - `Decimal` for numeric literals (decimal and hexadecimal forms alike, ADR-0001)
 * - `boolean` for true/false literals
 * - `CivilDateTime` for datetime literals (dateLiterals option only)
 * - `string` for string literals, identifiers, function names, and the keyword
 *   values enumerated above (operator/comparator/combinator/grouping/array/access/case)
 */
export type TokenValue =
  | null
  | boolean
  | string
  | Decimal
  | CivilDateTime
  | OperatorValue
  | ComparatorValue
  | CombinatorValue
  | GroupingValue
  | ArrayValue
  | AccessValue
  | CaseValue;

export interface Token {
  category: TokenCategory;
  value: TokenValue;
  raw: string;
  position: number;
}
