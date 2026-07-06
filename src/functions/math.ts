// Math function pack (issue 010): the pinned float64 list from PLAN.md.
//
// These are deliberate float64 bridges (Ruby ast/functions/ruby_math.rb
// parity): every argument is flattened like Ruby's `@args.flatten` (nested
// array arguments spread into the positional list), converted with
// `.toNumber()`, fed to the corresponding JS `Math` call, and the float
// result is re-wrapped in a `Decimal`. Decimal-native precision is neither
// promised nor attempted here.
//
// Domain violations: JS `Math` returns NaN where Ruby raises
// Math::DomainError (sqrt(-1), log(-1), acos(2), ...). A NaN result is
// therefore mapped to MathDomainError — NaN is never returned. Infinite
// results (e.g. exp(1000)) pass through, matching Ruby.
//
// `log` matches Ruby `Math.log(x, base = E)`: the optional second argument is
// the logarithm base. `pow(x, y)` is the function form of the `^` operator
// (no Ruby Math counterpart; pinned by PLAN.md).
import { Decimal } from "../decimal.js";
import { ArgumentCountError, MathDomainError, TypeMismatchError } from "../errors.js";
import { type Value, valueType } from "../values.js";
import type { FunctionDef } from "./types.js";

function flattenNumbers(name: string, args: readonly Value[], out: number[]): void {
  for (const arg of args) {
    if (Array.isArray(arg)) {
      flattenNumbers(name, arg, out);
      continue;
    }
    if (!(arg instanceof Decimal)) {
      throw new TypeMismatchError(`${name}() expects numeric arguments, got ${valueType(arg)}`);
    }
    out.push(arg.toNumber());
  }
}

/**
 * Builds one float64-bridge FunctionDef. `min`/`max` bound both the parse-time
 * comma count and the post-flattening argument count (Ruby reaches the same
 * counts through Math method arities; a flattened-count mismatch that would be
 * a bare Ruby ArgumentError surfaces as ArgumentCountError here).
 */
function mathDef(
  name: string,
  min: number,
  max: number,
  impl: (...xs: number[]) => number,
): FunctionDef {
  return {
    name,
    returnType: "numeric",
    minArgs: min,
    maxArgs: max,
    fn: (...args: Value[]): Value => {
      const xs: number[] = [];
      flattenNumbers(name, args, xs);
      if (xs.length < min || xs.length > max) {
        const expected = min === max ? `${min}` : `${min}..${max}`;
        throw new ArgumentCountError(
          `${name}() takes ${expected} numeric arguments, got ${xs.length}`,
        );
      }
      const result = impl(...xs);
      if (Number.isNaN(result)) {
        throw new MathDomainError(`${name}(${xs.join(", ")}) is outside the domain of ${name}`);
      }
      return new Decimal(result);
    },
  };
}

const unary = (name: string, impl: (x: number) => number): FunctionDef =>
  mathDef(name, 1, 1, (...xs) => impl(xs[0] as number));

const binary = (name: string, impl: (a: number, b: number) => number): FunctionDef =>
  mathDef(name, 2, 2, (...xs) => impl(xs[0] as number, xs[1] as number));

export const mathFunctions: FunctionDef[] = [
  unary("sin", Math.sin),
  unary("cos", Math.cos),
  unary("tan", Math.tan),
  unary("asin", Math.asin),
  unary("acos", Math.acos),
  unary("atan", Math.atan),
  binary("atan2", Math.atan2),
  unary("sinh", Math.sinh),
  unary("cosh", Math.cosh),
  unary("tanh", Math.tanh),
  unary("asinh", Math.asinh),
  unary("acosh", Math.acosh),
  unary("atanh", Math.atanh),
  unary("exp", Math.exp),
  // Ruby Math.log(x, base = E): natural log, or log to `base` with two args.
  mathDef("log", 1, 2, (...xs) =>
    xs.length === 1
      ? Math.log(xs[0] as number)
      : Math.log(xs[0] as number) / Math.log(xs[1] as number),
  ),
  unary("log2", Math.log2),
  unary("log10", Math.log10),
  unary("sqrt", Math.sqrt),
  unary("cbrt", Math.cbrt),
  binary("hypot", (a, b) => Math.hypot(a, b)),
  binary("pow", (a, b) => a ** b),
];

// Intentionally absent (PLAN.md backlog, not in the pinned list): erf, erfc,
// gamma, lgamma, frexp, ldexp.
