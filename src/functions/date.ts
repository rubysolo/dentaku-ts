// Date function pack: date, duration (issue 010).
//
// `date()` is the ADR-0004 construction path: dates originate in formula text
// only through `date("2026-07-04")` / `date(y, m, d)` (or context values, or
// the opt-in `dateLiterals` tokenizer flag). The string form accepts any
// ISO-8601 shape `CivilDateTime.parseISO` accepts, including full datetimes.
//
// `duration(value, unit)` is a special form (Ruby ast/functions/duration.rb
// parity): the unit argument arrives as an *unbound identifier* in the common
// spelling `duration(1, month)`, so the def uses `rawFn` to read the
// identifier's name without resolving it (a string literal unit is also
// accepted). Dependencies come from the value argument only — the unit
// identifier is never a variable (Ruby overrides `dependencies` identically).
import { IdentifierNode } from "../ast/identifier.js";
import { StringNode } from "../ast/literal.js";
import type { EvalContext, Node } from "../ast/node.js";
import { CivilDateTime, Duration } from "../civil-date.js";
import { Decimal } from "../decimal.js";
import { ArgumentCountError, ParseError, TypeMismatchError } from "../errors.js";
import { type Value, valueType } from "../values.js";
import type { FunctionDef } from "./types.js";

function numericField(v: Value, what: string): number {
  if (!(v instanceof Decimal)) {
    throw new TypeMismatchError(`date() ${what} must be numeric, got ${valueType(v)}`);
  }
  // CivilDateTime.of validates integer-ness and calendar range of the result.
  return v.toNumber();
}

/** The unit word exactly as written in the formula (never resolved). */
function unitWord(unitNode: Node): string {
  if (unitNode instanceof IdentifierNode) {
    return unitNode.identifier;
  }
  if (unitNode instanceof StringNode) {
    return unitNode.literal;
  }
  // Unreachable through the parser (checkArgs rejects other shapes at parse
  // time); kept for direct rawFn callers.
  throw new TypeMismatchError("duration() unit must be a bare unit word or a string literal");
}

export const dateFunctions: FunctionDef[] = [
  {
    name: "date",
    returnType: "datetime",
    minArgs: 1,
    maxArgs: 3,
    fn: (...args: Value[]): Value => {
      if (args.length === 1) {
        const input = args[0] as Value;
        if (typeof input !== "string") {
          throw new TypeMismatchError(
            `date() with one argument expects an ISO-8601 string, got ${valueType(input)}`,
          );
        }
        // parseISO's TypeMismatchError message includes the offending string.
        return CivilDateTime.parseISO(input);
      }
      if (args.length !== 3) {
        throw new ArgumentCountError(
          `date() expects 1 argument (ISO-8601 string) or 3 arguments (year, month, day), got ${args.length}`,
        );
      }
      const [year, month, day] = args as [Value, Value, Value];
      // CivilDateTime.of rejects dates that do not exist on the proleptic
      // Gregorian calendar (2023-02-29, month 13, ...) with TypeMismatchError.
      return CivilDateTime.of(
        numericField(year, "year"),
        numericField(month, "month"),
        numericField(day, "day"),
      );
    },
  },
  {
    name: "duration",
    returnType: "duration",
    minArgs: 2,
    maxArgs: 2,
    checkArgs: (argNodes: Node[]): void => {
      const unitNode = argNodes[1];
      if (!(unitNode instanceof IdentifierNode || unitNode instanceof StringNode)) {
        throw new ParseError(
          "duration() unit must be a bare unit word or a string literal (year/month/day, singular or plural)",
          "invalid-arguments",
        );
      }
    },
    rawFn: (argNodes: Node[], ctx: EvalContext): Value => {
      const [valueNode, unitNode] = argNodes as [Node, Node];
      const raw = valueNode.value(ctx);
      if (!(raw instanceof Decimal)) {
        throw new TypeMismatchError(`duration() value must be numeric, got ${valueType(raw)}`);
      }
      const unit = Duration.parseUnit(unitWord(unitNode));
      // Duration's constructor rejects non-integer values (issue 004).
      return new Duration(raw.toNumber(), unit);
    },
    // Ruby parity: only the value argument contributes dependencies; the unit
    // identifier is formula vocabulary, not a variable.
    dependencies: (argNodes: Node[], ctx?: EvalContext): string[] =>
      argNodes[0]?.dependencies(ctx) ?? [],
  },
];
