// Numeric function pack: min, max, sum, avg, mul, count, round, rounddown,
// roundup, abs, intercept (issue 007).
//
// Ported from Ruby dentaku v3.5.7 lib/dentaku/ast/functions/*.rb with the
// ADR-0003.3 tightening: every numeric argument must already be a Decimal —
// there is no string→number coercion (Ruby's Function.numeric cast numeric
// strings at eval time). Ruby's single Dentaku::ArgumentError splits into our
// ArgumentCountError (wrong arity) and TypeMismatchError (wrong type).
//
// Internal-only deviation: rounddown/roundup are computed with exact Decimal
// arithmetic instead of Ruby's Float `10.0**precision` scaling; the rounding
// direction (floor toward -infinity, ceil toward +infinity — Ruby's
// Float#floor/#ceil, so ROUNDDOWN(-1.8) is -2) and all results match Ruby.
import { requireDecimal } from "../ast/operands.js";
import { Decimal } from "../decimal.js";
import { ArgumentCountError, TypeMismatchError, ZeroDivisionError } from "../errors.js";
import { type Value, valueType } from "../values.js";
import type { FunctionDef } from "./types.js";

/** Deep array flattening (Ruby Array#flatten parity, used by min/max/sum/mul/avg). */
function deepFlatten(args: readonly Value[]): Value[] {
  const out: Value[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      out.push(...deepFlatten(arg));
    } else {
      out.push(arg);
    }
  }
  return out;
}

/** Flattens and requires every element to be a Decimal (ADR-0003.3). */
function numericElements(name: string, args: readonly Value[]): Decimal[] {
  return deepFlatten(args).map((v) => requireDecimal(v, `${name}()`));
}

/**
 * Ruby registered sum/mul as splat lambdas (parse-time min_param_count 0), so
 * the ≥1-arg rule fires at eval time as Dentaku::ArgumentError — hence
 * minArgs: 0 on the defs plus this eval-time ArgumentCountError.
 */
function requireAtLeastOne(name: string, count: number): void {
  if (count === 0) {
    throw new ArgumentCountError(`${name}() requires at least one argument`);
  }
}

/**
 * Rounds `n` at `places` decimal places with the given decimal.js mode.
 * Negative places round to tens/hundreds/... (BigDecimal#round parity);
 * decimal.js toDecimalPlaces rejects negative dp, so shift-round-unshift with
 * an exact power of ten.
 */
function roundAt(n: Decimal, places: number, mode: Decimal.Rounding): Decimal {
  if (places >= 0) {
    return n.toDecimalPlaces(places, mode);
  }
  const factor = new Decimal(10).pow(-places);
  return n.div(factor).toDecimalPlaces(0, mode).mul(factor);
}

/**
 * The optional places/precision argument: absent or null means 0 (Ruby
 * `places || 0`), anything else must be a Decimal, truncated to an integer
 * (Ruby `.to_i`).
 */
function placesArg(name: string, places: Value | undefined): number {
  if (places === undefined || places === null) {
    return 0;
  }
  return requireDecimal(places, `${name}()`).truncated().toNumber();
}

function roundingDef(name: string, mode: Decimal.Rounding): FunctionDef {
  return {
    name,
    returnType: "numeric",
    minArgs: 1,
    maxArgs: 2,
    fn: (...args: Value[]): Value => {
      const n = requireDecimal(args[0] as Value, `${name.toUpperCase()}()`);
      return roundAt(n, placesArg(name.toUpperCase(), args[1]), mode);
    },
  };
}

const minDef: FunctionDef = {
  name: "min",
  returnType: "numeric",
  minArgs: 0,
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    const nums = numericElements("MIN", args);
    // Ruby parity: `[].min` is nil, no error for empty input.
    return nums.length === 0 ? null : nums.reduce((a, b) => (b.lt(a) ? b : a));
  },
};

const maxDef: FunctionDef = {
  name: "max",
  returnType: "numeric",
  minArgs: 0,
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    const nums = numericElements("MAX", args);
    // Ruby parity: `[].max` is nil, no error for empty input.
    return nums.length === 0 ? null : nums.reduce((a, b) => (b.gt(a) ? b : a));
  },
};

const sumDef: FunctionDef = {
  name: "sum",
  returnType: "numeric",
  minArgs: 0, // ≥1 enforced at eval time as ArgumentCountError (Ruby parity).
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    requireAtLeastOne("SUM", args.length);
    // SUM(x) with x = [] is 0, not an error (Ruby reduce(0, :+)).
    return numericElements("SUM", args).reduce((a, b) => a.plus(b), new Decimal(0));
  },
};

const mulDef: FunctionDef = {
  name: "mul",
  returnType: "numeric",
  minArgs: 0, // ≥1 enforced at eval time as ArgumentCountError (Ruby parity).
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    requireAtLeastOne("MUL", args.length);
    // MUL(x) with x = [] is 1, not an error (Ruby reduce(1, :*)).
    return numericElements("MUL", args).reduce((a, b) => a.times(b), new Decimal(1));
  },
};

const avgDef: FunctionDef = {
  name: "avg",
  returnType: "numeric",
  minArgs: 0, // ≥1 enforced at eval time as ArgumentCountError (Ruby parity).
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    const nums = numericElements("AVG", args);
    // Ruby checks the *flattened* list, so AVG(x) with x = [] is also an error.
    requireAtLeastOne("AVG", nums.length);
    return nums.reduce((a, b) => a.plus(b), new Decimal(0)).div(nums.length);
  },
};

const countDef: FunctionDef = {
  name: "count",
  returnType: "numeric",
  minArgs: 0,
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    // Ruby parity: a single argument that responds to #length reports its
    // length — arrays, strings (COUNT("dentaku") is 7), and hashes/objects.
    if (args.length === 1) {
      const first = args[0] as Value;
      if (typeof first === "string" || Array.isArray(first)) {
        return new Decimal(first.length);
      }
      if (valueType(first) === "object") {
        return new Decimal(Object.keys(first as object).length);
      }
    }
    return new Decimal(args.length);
  },
};

const absDef: FunctionDef = {
  name: "abs",
  returnType: "numeric",
  fn: (numeric: Value): Value => requireDecimal(numeric, "ABS()").abs(),
};

const interceptDef: FunctionDef = {
  name: "intercept",
  // Ruby registered intercept as :list; its result is a number.
  returnType: "numeric",
  minArgs: 0, // exactly-2 enforced at eval time as ArgumentCountError (Ruby parity).
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    if (args.length !== 2) {
      throw new ArgumentCountError(
        `INTERCEPT() requires exactly two arrays of numbers (given ${args.length})`,
      );
    }
    const [rawXs, rawYs] = args as [Value, Value];
    if (!Array.isArray(rawXs) || !Array.isArray(rawYs) || rawXs.length !== rawYs.length) {
      throw new TypeMismatchError("INTERCEPT() requires arrays of equal length");
    }
    // Ruby fell into Float NaN/FloatDomainError territory on empty arrays; a
    // typed error is friendlier and stays inside the DentakuError taxonomy.
    if (rawXs.length === 0) {
      throw new TypeMismatchError("INTERCEPT() requires non-empty arrays");
    }
    const xs = rawXs.map((v) => requireDecimal(v, "INTERCEPT()"));
    const ys = rawYs.map((v) => requireDecimal(v, "INTERCEPT()"));
    const n = new Decimal(xs.length);

    const sum = (list: Decimal[]): Decimal => list.reduce((a, b) => a.plus(b), new Decimal(0));
    const xAvg = sum(xs).div(n);
    const yAvg = sum(ys).div(n);

    const xySum = sum(xs.map((x, i) => xAvg.minus(x).times(yAvg.minus(ys[i] as Decimal))));
    const xSquareSum = sum(xs.map((x) => xAvg.minus(x).pow(2)));
    // Ruby divided by zero in Float land (NaN → FloatDomainError); keep it typed.
    if (xSquareSum.isZero()) {
      throw new ZeroDivisionError("INTERCEPT() x-values have zero variance");
    }
    const slope = xySum.div(xSquareSum);
    return sum(ys.map((y, i) => y.minus(slope.times(xs[i] as Decimal)))).div(n);
  },
};

export const numericFunctions: FunctionDef[] = [
  minDef,
  maxDef,
  sumDef,
  mulDef,
  avgDef,
  countDef,
  roundingDef("round", Decimal.ROUND_HALF_UP),
  roundingDef("rounddown", Decimal.ROUND_FLOOR),
  roundingDef("roundup", Decimal.ROUND_CEIL),
  absDef,
  interceptDef,
];
