// Arithmetic operation nodes (Ruby ast/arithmetic.rb lineage).
//
// Eval-time semantics per docs/issues/006 and ADR-0003.3: operands must be
// Decimal (no string→number coercion; Ruby coerced stringly context values),
// except the datetime special cases on `+`/`-`, which delegate to issue 004's
// civil-date helpers. All arithmetic is exact Decimal.
import { applyDuration, CivilDateTime } from "../civil-date.js";
import type { Decimal } from "../decimal.js";
import { MathDomainError, ParseError, TypeMismatchError, ZeroDivisionError } from "../errors.js";
import {
  type CivilDateTime as CivilDateTimeFields,
  isCivilDateTime,
  isDuration,
  type Value,
} from "../values.js";
import type { EvalContext, Node } from "./node.js";
import { arithmeticOperandOk, requireDecimal, unionDependencies } from "./operands.js";

export type ArithmeticOp = "add" | "subtract" | "multiply" | "divide" | "mod" | "pow";

const DISPLAY: Readonly<Record<ArithmeticOp, string>> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
  mod: "%",
  pow: "^",
};

/** `datetime + numeric(days) | duration` (Ruby DateArithmetic#add). */
function dateAdd(base: CivilDateTimeFields, right: Value): Value {
  if (isDuration(right)) {
    return applyDuration(base, right, 1);
  }
  const days = requireDecimal(right, "datetime addition");
  return CivilDateTime.from(base).addDays(days.toNumber());
}

/** `datetime - datetime(→ days) | duration | numeric(days)` (Ruby DateArithmetic#sub). */
function dateSub(base: CivilDateTimeFields, right: Value): Value {
  if (isCivilDateTime(right)) {
    return CivilDateTime.from(base).diffDays(right);
  }
  if (isDuration(right)) {
    return applyDuration(base, right, -1);
  }
  const days = requireDecimal(right, "datetime subtraction");
  return CivilDateTime.from(base).addDays(-days.toNumber());
}

/** Floored modulo (sign of the divisor), matching Ruby BigDecimal `%`. */
function flooredMod(l: Decimal, r: Decimal): Decimal {
  const remainder = l.mod(r); // decimal.js: truncated remainder, sign of the dividend
  if (remainder.isZero() || remainder.isNegative() === r.isNegative()) {
    return remainder;
  }
  return remainder.plus(r);
}

export class ArithmeticNode implements Node {
  readonly op: ArithmeticOp;
  readonly left: Node;
  readonly right: Node;
  readonly type = "numeric";

  constructor(op: ArithmeticOp, left: Node, right: Node) {
    this.op = op;
    this.left = left;
    this.right = right;
    // Ruby parity: operands with a statically known incompatible type are
    // rejected at parse time (string literals in arithmetic never parsed).
    // Datetimes are admissible on the left, datetime/duration on the right.
    if (!arithmeticOperandOk(left, ["datetime"])) {
      throw new ParseError(
        `${this.operator} requires numeric operands, got ${left.type}`,
        "node-invalid",
      );
    }
    if (!arithmeticOperandOk(right, ["datetime", "duration"])) {
      throw new ParseError(
        `${this.operator} requires numeric operands, got ${right.type}`,
        "node-invalid",
      );
    }
  }

  /** Display form of the operator (for messages and the issue-013 printer). */
  get operator(): string {
    return DISPLAY[this.op];
  }

  value(ctx: EvalContext): Value {
    const l = this.left.value(ctx);
    const r = this.right.value(ctx);

    // ADR-0004: date arithmetic goes through the civil-date helpers.
    if (isCivilDateTime(l)) {
      if (this.op === "add") {
        return dateAdd(l, r);
      }
      if (this.op === "subtract") {
        return dateSub(l, r);
      }
      throw new TypeMismatchError(`'${this.operator}' is not defined on datetime values`);
    }

    const a = requireDecimal(l, `'${this.operator}'`);
    const b = requireDecimal(r, `'${this.operator}'`);
    switch (this.op) {
      case "add":
        return a.plus(b);
      case "subtract":
        return a.minus(b);
      case "multiply":
        return a.times(b);
      case "divide":
        if (b.isZero()) {
          throw new ZeroDivisionError("division by zero");
        }
        return a.div(b);
      case "mod":
        if (b.isZero()) {
          throw new ZeroDivisionError("modulo by zero");
        }
        return flooredMod(a, b);
      case "pow": {
        if (a.isZero() && b.isNegative()) {
          throw new ZeroDivisionError("zero cannot be raised to a negative power");
        }
        const result = a.pow(b);
        if (result.isNaN()) {
          throw new MathDomainError(`${a.toString()} ^ ${b.toString()} is outside the real domain`);
        }
        return result;
      }
    }
  }

  dependencies(ctx?: EvalContext): string[] {
    return unionDependencies([this.left, this.right], ctx);
  }
}
