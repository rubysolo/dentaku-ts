// Successor precedence table (PLAN.md "Precedence table (successor)").
//
// | Prec | Operators              | Assoc |
// |  50  | unary -                | right |
// |  40  | ^ (pow), postfix %     | left  |
// |  30  | * / % (mod)            | left  |
// |  20  | + -                    | left  |
// |  15  | << >>                  | left  |  ADR-0003.4
// |  12  | &                      | left  |  ADR-0003.4
// |  11  | |                      | left  |  ADR-0003.4
// |   5  | < > <= >= = == != <>   | left  |
// |   2  | and &&                 | left  |
// |   1  | or ||                  | left  |
//
// Rows 15/12/11 are the ADR-0003.4 tightening (Ruby had `| & << >>` at
// precedence 0, below comparators); every other row is Ruby's table rescaled.
// `^` is LEFT-associative (Ruby dentaku parity, not math convention) and
// unary `-` binds tighter than `^`: `-2 ^ 2 = 4`, `2 ^ 3 ^ 2 = 64`.

/** Internal operation names: operator tokens plus the resolved postfix percentage. */
export type OperationName =
  | "negate"
  | "pow"
  | "percentage"
  | "multiply"
  | "divide"
  | "mod"
  | "add"
  | "subtract"
  | "shiftleft"
  | "shiftright"
  | "bitand"
  | "bitor"
  | "lt"
  | "gt"
  | "le"
  | "ge"
  | "ne"
  | "eq"
  | "and"
  | "or";

export const PRECEDENCE: Readonly<Record<OperationName, number>> = {
  negate: 50,
  pow: 40,
  percentage: 40,
  multiply: 30,
  divide: 30,
  mod: 30,
  add: 20,
  subtract: 20,
  shiftleft: 15, // ADR-0003.4
  shiftright: 15, // ADR-0003.4
  bitand: 12, // ADR-0003.4
  bitor: 11, // ADR-0003.4
  lt: 5,
  gt: 5,
  le: 5,
  ge: 5,
  ne: 5,
  eq: 5,
  and: 2,
  or: 1,
};

/** Only unary minus is right-associative. */
export function isRightAssociative(op: OperationName): boolean {
  return op === "negate";
}
