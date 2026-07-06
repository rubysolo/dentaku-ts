// Math function pack (issue 010): float64 bridges over JS Math, Ruby
// ast/functions/ruby_math.rb parity (spec/function_spec.rb ground truth).
import { describe, expect, it } from "vitest";
import { Scope } from "../src/ast/index.js";
import type { Binding } from "../src/ast/node.js";
import { Decimal } from "../src/decimal.js";
import {
  ArgumentCountError,
  MathDomainError,
  ParseError,
  TypeMismatchError,
} from "../src/errors.js";
import { mathFunctions } from "../src/functions/math.js";
import { FunctionSet } from "../src/functions/registry.js";
import { parseFormula } from "../src/parser/parser.js";
import type { Value } from "../src/values.js";

const registry = new FunctionSet(mathFunctions);

function evaluate(formula: string, vars: Record<string, Binding> = {}): Value {
  return parseFormula(formula, { registry }).value(Scope.of(vars));
}

function num(formula: string, vars: Record<string, Binding> = {}): number {
  const v = evaluate(formula, vars);
  expect(v).toBeInstanceOf(Decimal);
  return (v as Decimal).toNumber();
}

describe("math pack: known values", () => {
  it("covers the pinned function list exactly", () => {
    const pinned = [
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "sinh",
      "cosh",
      "tanh",
      "asinh",
      "acosh",
      "atanh",
      "exp",
      "log",
      "log2",
      "log10",
      "sqrt",
      "cbrt",
      "hypot",
      "pow",
    ];
    expect(mathFunctions.map((d) => d.name)).toEqual(pinned);
  });

  it("sin", () => {
    expect(num("sin(0)")).toBe(0);
    expect(num("sin(1)")).toBeCloseTo(0.8414709848078965, 12);
  });

  it("cos", () => {
    expect(num("cos(0)")).toBe(1);
    expect(num("cos(1)")).toBeCloseTo(0.5403023058681398, 12);
  });

  it("tan", () => {
    expect(num("tan(0)")).toBe(0);
    expect(num("tan(1)")).toBeCloseTo(1.5574077246549023, 12);
  });

  it("asin", () => {
    // asin(0.5) = pi/6
    expect(num("asin(0.5)")).toBeCloseTo(0.5235987755982989, 12);
  });

  it("acos", () => {
    // acos(0.5) = pi/3
    expect(num("acos(0.5)")).toBeCloseTo(1.0471975511965979, 12);
  });

  it("atan", () => {
    // atan(1) = pi/4
    expect(num("atan(1)")).toBeCloseTo(0.7853981633974483, 12);
  });

  it("atan2", () => {
    // atan2(1, 1) = pi/4; quadrant-aware: atan2(-1, -1) = -3*pi/4
    expect(num("atan2(1, 1)")).toBeCloseTo(0.7853981633974483, 12);
    expect(num("atan2(-1, -1)")).toBeCloseTo(-2.356194490192345, 12);
  });

  it("sinh", () => {
    expect(num("sinh(1)")).toBeCloseTo(1.1752011936438014, 12);
  });

  it("cosh", () => {
    expect(num("cosh(1)")).toBeCloseTo(1.5430806348152437, 12);
  });

  it("tanh", () => {
    expect(num("tanh(1)")).toBeCloseTo(0.7615941559557649, 12);
  });

  it("asinh", () => {
    expect(num("asinh(1)")).toBeCloseTo(0.881373587019543, 12);
  });

  it("acosh", () => {
    expect(num("acosh(1)")).toBe(0);
    expect(num("acosh(2)")).toBeCloseTo(1.3169578969248166, 12);
  });

  it("atanh", () => {
    expect(num("atanh(0)")).toBe(0);
    expect(num("atanh(0.5)")).toBeCloseTo(0.5493061443340549, 12);
  });

  it("exp", () => {
    expect(num("exp(0)")).toBe(1);
    expect(num("exp(1)")).toBeCloseTo(Math.E, 12);
  });

  it("log is natural log with an optional base (Ruby Math.log(x, base))", () => {
    expect(num("log(1)")).toBe(0);
    expect(num("log(2.718281828459045)")).toBeCloseTo(1, 12);
    expect(num("log(8, 2)")).toBeCloseTo(3, 12);
    expect(num("log(1000, 10)")).toBeCloseTo(3, 12);
  });

  it("log2", () => {
    expect(num("log2(8)")).toBe(3);
    expect(num("log2(1)")).toBe(0);
  });

  it("log10", () => {
    expect(num("log10(1000)")).toBe(3);
    expect(num("log10(1)")).toBe(0);
  });

  it("sqrt", () => {
    expect(num("sqrt(16)")).toBe(4);
    expect(num("sqrt(2)")).toBeCloseTo(Math.SQRT2, 12);
  });

  it("cbrt", () => {
    expect(num("cbrt(27)")).toBe(3);
    // Real cube root of a negative number (Ruby Math.cbrt(-8) == -2).
    expect(num("cbrt(-8)")).toBe(-2);
  });

  it("hypot", () => {
    expect(num("hypot(3, 4)")).toBe(5);
    expect(num("hypot(1, 1)")).toBeCloseTo(Math.SQRT2, 12);
  });

  it("pow mirrors ^", () => {
    expect(num("pow(2, 10)")).toBe(1024);
    expect(num("pow(2, 0.5)")).toBeCloseTo(Math.SQRT2, 12);
    expect(num("pow(2, -1)")).toBe(0.5);
  });

  it("function names are case-insensitive", () => {
    expect(num("SQRT(16)")).toBe(4);
    expect(num("Atan2(1, 1)")).toBeCloseTo(0.7853981633974483, 12);
  });

  it("results are re-wrapped as Decimal and compose with arithmetic", () => {
    expect(num("sqrt(16) + 1")).toBe(5);
  });
});

describe("math pack: Ruby-style argument flattening", () => {
  it("flattens an array literal argument", () => {
    expect(num("sqrt({16})")).toBe(4);
  });

  it("flattens array arguments into the positional list", () => {
    expect(num("atan2({1}, 1)")).toBeCloseTo(0.7853981633974483, 12);
    expect(num("hypot(a, 4)", { a: [new Decimal(3)] })).toBe(5);
  });

  it("flattens nested arrays", () => {
    expect(num("hypot(a, 4)", { a: [[new Decimal(3)]] })).toBe(5);
  });

  it("rejects a flattened count that misses the arity", () => {
    // Ruby ends up calling Math.sqrt(4, 9) and raises a bare ::ArgumentError;
    // dentaku-ts keeps the failure inside the DentakuError taxonomy
    // (ADR-0002: only DentakuError subclasses are catchable outcomes).
    expect(() => evaluate("sqrt({4, 9})")).toThrow(ArgumentCountError);
  });
});

describe("math pack: domain errors (Ruby Math::DomainError parity)", () => {
  const cases = [
    "sqrt(-1)",
    "log(-1)",
    "log(-1, 2)",
    "log2(-1)",
    "log10(-1)",
    "asin(2)",
    "asin(-2)",
    "acos(2)",
    "acos(-2)",
    "acosh(0.5)",
    "atanh(2)",
    "atanh(-2)",
    "pow(-1, 0.5)",
  ];

  for (const formula of cases) {
    it(`${formula} throws MathDomainError`, () => {
      expect(() => evaluate(formula)).toThrow(MathDomainError);
    });
  }

  it("never returns NaN", () => {
    for (const formula of cases) {
      let threw = false;
      try {
        evaluate(formula);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
  });
});

describe("math pack: argument validation", () => {
  it("rejects non-numeric arguments", () => {
    expect(() => evaluate('sqrt("four")')).toThrow(TypeMismatchError);
    expect(() => evaluate("sin(true)")).toThrow(TypeMismatchError);
  });

  it("enforces arity at parse time", () => {
    expect(() => parseFormula("sqrt(1, 2)", { registry })).toThrow(ParseError);
    expect(() => parseFormula("atan2(1)", { registry })).toThrow(ParseError);
    expect(() => parseFormula("log(1, 2, 3)", { registry })).toThrow(ParseError);
    expect(() => parseFormula("hypot(1, 2, 3)", { registry })).toThrow(ParseError);
  });

  it("does not define the PLAN.md backlog functions", () => {
    // erf erfc gamma lgamma frexp ldexp are intentionally absent (issue 010).
    for (const name of ["erf", "erfc", "gamma", "lgamma", "frexp", "ldexp"]) {
      expect(registry.get(name)).toBeUndefined();
    }
  });
});
