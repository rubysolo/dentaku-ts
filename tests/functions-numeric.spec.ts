// Ported from Ruby dentaku v3.5.7: spec/ast/{max,min,sum,mul,avg,count,round,
// rounddown,roundup,abs,intercept}_spec.rb.
//
// Every deviation from Ruby behavior is annotated with its ADR tightening:
//   ADR-0003.3 no string→number coercion (Ruby's Function.numeric cast "2.3")
//   ADR-0003.5 bare date literals default off (2020-1-1 is arithmetic → 2018)
// Ruby-parity notes: Ruby's single Dentaku::ArgumentError maps to
// ArgumentCountError (arity) or TypeMismatchError (type) in our taxonomy.
import { describe, expect, it } from "vitest";
import { Scope } from "../src/ast/index.js";
import type { Binding, Node } from "../src/ast/node.js";
import { ArgumentCountError, TypeMismatchError } from "../src/errors.js";
import { logicFunctions } from "../src/functions/logic.js";
import { numericFunctions } from "../src/functions/numeric.js";
import { FunctionSet } from "../src/functions/registry.js";
import { parseFormula } from "../src/parser/parser.js";
import { type ExternalValue, toExternal, toInternal } from "../src/values.js";

const registry = new FunctionSet([...logicFunctions, ...numericFunctions]);

function context(vars: Record<string, ExternalValue> = {}): Scope {
  const bindings: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(vars)) {
    bindings[k] = toInternal(v);
  }
  return Scope.of(bindings);
}

function ast(formula: string): Node {
  return parseFormula(formula, { registry });
}

function evaluate(formula: string, vars: Record<string, ExternalValue> = {}): ExternalValue {
  return toExternal(ast(formula).value(context(vars)));
}

// --- spec/ast/max_spec.rb -------------------------------------------------------

describe("MAX (spec/ast/max_spec.rb)", () => {
  it("returns the largest numeric value in an array of Numeric values", () => {
    expect(evaluate("MAX(1, x, 1.8)", { x: 2.3 })).toBe(2.3);
  });

  it("raises a type error if a String is passed", () => {
    // ADR-0003.3: Ruby coerced '2.3' and answered 2.3.
    expect(() => evaluate("MAX(1, x, 1.8)", { x: "2.3" })).toThrow(TypeMismatchError);
  });

  it("returns the largest value even if an Array is passed", () => {
    expect(evaluate("MAX(1, x, 1.8)", { x: [1.5, 2.3, 1.7] })).toBe(2.3);
  });

  it("returns the largest value if only an Array is passed", () => {
    expect(evaluate("MAX(x)", { x: [1.5, 2.3, 1.7] })).toBe(2.3);
  });

  it("flattens nested arrays deeply", () => {
    expect(evaluate("MAX(x)", { x: [1, [2, [5]], 3] })).toBe(5);
  });

  it("does not raise an error if an empty array is passed", () => {
    expect(evaluate("MAX(x)", { x: [] })).toBeNull();
  });
});

// --- spec/ast/min_spec.rb -------------------------------------------------------

describe("MIN (spec/ast/min_spec.rb)", () => {
  it("returns the smallest numeric value in an array of Numeric values", () => {
    expect(evaluate("MIN(1, x, 1.8)", { x: 2.3 })).toBe(1);
  });

  it("raises a type error if a String is passed", () => {
    // ADR-0003.3: Ruby coerced '0.3' and answered 0.3.
    expect(() => evaluate("MIN(1, x, 1.8)", { x: "0.3" })).toThrow(TypeMismatchError);
    // The typed form keeps the case's intent.
    expect(evaluate("MIN(1, x, 1.8)", { x: 0.3 })).toBe(0.3);
  });

  it("returns the smallest value even if an Array is passed", () => {
    expect(evaluate("MIN(1, x, 1.8)", { x: [1.5, 0.3, 1.7] })).toBe(0.3);
  });

  it("returns the smallest value if only an Array is passed", () => {
    expect(evaluate("MIN(x)", { x: [1.5, 2.3, 1.7] })).toBe(1.5);
  });

  it("does not raise an error if an empty array is passed", () => {
    expect(evaluate("MIN(x)", { x: [] })).toBeNull();
  });
});

// --- spec/ast/sum_spec.rb -------------------------------------------------------

describe("SUM (spec/ast/sum_spec.rb)", () => {
  it("returns the sum of an array of Numeric values", () => {
    expect(evaluate("SUM(1, x, 1.8)", { x: 2.3 })).toBe(5.1);
  });

  it("returns the sum of a single entry array of a Numeric value", () => {
    expect(evaluate("SUM(x)", { x: 2.3 })).toBe(2.3);
  });

  it("raises a type error if a String is passed", () => {
    // ADR-0003.3: Ruby coerced '2.3' and answered 5.1.
    expect(() => evaluate("SUM(1, x, 1.8)", { x: "2.3" })).toThrow(TypeMismatchError);
  });

  it("returns the sum even if an array is passed", () => {
    expect(evaluate("SUM(1, x, 2.3)", { x: [4, 5] })).toBe(12.3);
  });

  it("returns the sum of nested sums", () => {
    // ADR-0003.3: Ruby's x: '2.3' string binding is typed here.
    expect(evaluate("SUM(1, x, SUM(4, 5))", { x: 2.3 })).toBe(12.3);
  });

  it("flattens nested arrays deeply", () => {
    expect(evaluate("SUM(x)", { x: [1, [2, [3]]] })).toBe(6);
  });

  it("raises an error if no arguments are passed", () => {
    // Ruby: Dentaku::ArgumentError at eval time (splat lambda, no parse arity).
    expect(() => evaluate("SUM()")).toThrow(ArgumentCountError);
  });

  it("does not raise an error if an empty array is passed", () => {
    expect(evaluate("SUM(x)", { x: [] })).toBe(0);
  });
});

// --- spec/ast/mul_spec.rb -------------------------------------------------------

describe("MUL (spec/ast/mul_spec.rb)", () => {
  it("returns the product of an array of Numeric values", () => {
    expect(evaluate("MUL(1, x, 1.8)", { x: 2.3 })).toBe(4.14);
  });

  it("returns the product of a single entry array of a Numeric value", () => {
    expect(evaluate("MUL(x)", { x: 2.3 })).toBe(2.3);
  });

  it("raises a type error for string inputs", () => {
    // ADR-0003.3: Ruby's "coerces string inputs to numeric" case, inverted.
    expect(() => evaluate("mul(1, x, 1.8)", { x: "2.3" })).toThrow(TypeMismatchError);
  });

  it("returns the product even if an array is passed", () => {
    expect(evaluate("mul(1, x, 2.3)", { x: [4, 5] })).toBe(46);
  });

  it("handles nested calls", () => {
    // ADR-0003.3: Ruby's x: '2.3' string binding is typed here.
    expect(evaluate("mul(1, x, mul(4, 5))", { x: 2.3 })).toBe(46);
  });

  it("raises an error if no arguments are passed", () => {
    expect(() => evaluate("MUL()")).toThrow(ArgumentCountError);
  });

  it("does not raise an error if an empty array is passed", () => {
    expect(evaluate("MUL(x)", { x: [] })).toBe(1);
  });
});

// --- spec/ast/avg_spec.rb -------------------------------------------------------

describe("AVG (spec/ast/avg_spec.rb)", () => {
  it("returns the average of an array of Numeric values as exact Decimal", () => {
    expect(evaluate("AVG(1, 2)")).toBe(1.5);
  });

  it("returns the average of an array of Numeric values", () => {
    expect(evaluate("AVG(1, x, 1.8)", { x: 2.3 })).toBe(1.7);
  });

  it("returns the average of a single entry array of a Numeric value", () => {
    expect(evaluate("AVG(x)", { x: 2.3 })).toBe(2.3);
  });

  it("raises a type error if a String is passed", () => {
    // ADR-0003.3: Ruby coerced '2.3' and answered 1.7.
    expect(() => evaluate("AVG(1, x, 1.8)", { x: "2.3" })).toThrow(TypeMismatchError);
  });

  it("returns the average even if an array is passed", () => {
    expect(evaluate("AVG(1, x, 2.3)", { x: [4, 5] })).toBe(3.075);
  });

  it("raises an error if no arguments are passed", () => {
    expect(() => evaluate("AVG()")).toThrow(ArgumentCountError);
  });

  it("raises an error if an empty array is passed", () => {
    // Ruby checks the flattened element count, so AVG(x) with x: [] raises too.
    expect(() => evaluate("AVG(x)", { x: [] })).toThrow(ArgumentCountError);
  });
});

// --- spec/ast/count_spec.rb -----------------------------------------------------

describe("COUNT (spec/ast/count_spec.rb)", () => {
  it("returns the length of an array", () => {
    expect(evaluate("COUNT(1, x, 1.8)", { x: 2.3 })).toBe(3);
  });

  it("returns the length of a single number object", () => {
    expect(evaluate("COUNT(x)", { x: 2.3 })).toBe(1);
  });

  it("returns the length if a single String is passed", () => {
    expect(evaluate("COUNT(x)", { x: "dentaku" })).toBe(7);
  });

  it("returns the length if an array is passed", () => {
    expect(evaluate("COUNT(x)", { x: [4, 5] })).toBe(2);
  });

  it("returns the length if an array with one element is passed", () => {
    expect(evaluate("COUNT(x)", { x: [4] })).toBe(1);
  });

  it("returns the argument count even with nested arrays (no flattening)", () => {
    expect(evaluate("COUNT(1, x, 3)", { x: [4, 5] })).toBe(3);
  });

  it("returns zero for an empty call", () => {
    expect(evaluate("COUNT()")).toBe(0);
  });
});

// --- spec/ast/round_spec.rb -----------------------------------------------------

describe("ROUND (spec/ast/round_spec.rb)", () => {
  it("returns the rounded value", () => {
    expect(evaluate("ROUND(1.8)")).toBe(2);
  });

  it("rounds half up (ADR-0001 configured rounding, BigDecimal parity)", () => {
    expect(evaluate("ROUND(2.5)")).toBe(3);
    expect(evaluate("ROUND(1.5)")).toBe(2);
  });

  it("returns the rounded value to the given precision", () => {
    expect(evaluate("ROUND(x, y)", { x: 1.8453, y: 3 })).toBe(1.845);
  });

  it("raises a type error with string arguments", () => {
    // ADR-0003.3: Ruby coerced '1.8453' and '3' and answered 1.845.
    expect(() => evaluate("ROUND(x, y)", { x: "1.8453", y: "3" })).toThrow(TypeMismatchError);
    expect(() => evaluate("ROUND(x, y)", { x: 1.8453, y: "3" })).toThrow(TypeMismatchError);
  });

  it("returns the rounded value to the given precision, also with nil", () => {
    expect(evaluate("ROUND(x, y)", { x: 1.8453, y: null })).toBe(2);
  });

  it("supports negative precision (BigDecimal#round parity)", () => {
    expect(evaluate("ROUND(1234, -2)")).toBe(1200);
    expect(evaluate("ROUND(1250, -2)")).toBe(1300);
  });

  it("treats a bare date literal as arithmetic", () => {
    // ADR-0003.5: Ruby (raw_date_literals: true) parsed 2020-1-1 as a Date and
    // raised Dentaku::ArgumentError; with date literals off it is 2018.
    expect(evaluate("ROUND(2020-1-1, 0)")).toBe(2018);
  });

  it("raises an error if arguments are not numeric", () => {
    expect(() => evaluate('ROUND("abc", 0)')).toThrow(TypeMismatchError);
    expect(() => evaluate('ROUND(1.8, "abc")')).toThrow(TypeMismatchError);
  });
});

// --- spec/ast/rounddown_spec.rb -------------------------------------------------

describe("ROUNDDOWN (spec/ast/rounddown_spec.rb)", () => {
  it("returns the rounded value", () => {
    expect(evaluate("ROUNDDOWN(1.8)")).toBe(1);
  });

  it("returns the rounded value to the given precision", () => {
    expect(evaluate("ROUNDDOWN(x, y)", { x: 1.8453, y: 3 })).toBe(1.845);
  });

  it("raises a type error with string arguments", () => {
    // ADR-0003.3: Ruby coerced strings and answered 1.845.
    expect(() => evaluate("ROUNDDOWN(x, y)", { x: "1.8453", y: "3" })).toThrow(TypeMismatchError);
  });

  it("returns the rounded value to the given precision, also with nil", () => {
    expect(evaluate("ROUNDDOWN(x, y)", { x: 1.8453, y: null })).toBe(1);
  });

  it("floors toward negative infinity (Ruby Float#floor parity)", () => {
    expect(evaluate("ROUNDDOWN(-1.8)")).toBe(-2);
    expect(evaluate("ROUNDDOWN(x, y)", { x: -1.8453, y: 3 })).toBe(-1.846);
  });

  it("supports negative precision", () => {
    expect(evaluate("ROUNDDOWN(1666, -2)")).toBe(1600);
  });

  it("raises an error if arguments are not numeric", () => {
    expect(() => evaluate('ROUNDDOWN("abc", 0)')).toThrow(TypeMismatchError);
    expect(() => evaluate('ROUNDDOWN(1.8, "abc")')).toThrow(TypeMismatchError);
  });
});

// --- spec/ast/roundup_spec.rb ---------------------------------------------------

describe("ROUNDUP (spec/ast/roundup_spec.rb)", () => {
  it("returns the rounded value", () => {
    expect(evaluate("ROUNDUP(1.8)")).toBe(2);
  });

  it("returns the rounded value to the given precision", () => {
    expect(evaluate("ROUNDUP(x, y)", { x: 1.8453, y: 3 })).toBe(1.846);
  });

  it("raises a type error with string arguments", () => {
    // ADR-0003.3: Ruby coerced strings and answered 1.846.
    expect(() => evaluate("ROUNDUP(x, y)", { x: "1.8453", y: "3" })).toThrow(TypeMismatchError);
  });

  it("returns the rounded value to the given precision, also with nil", () => {
    expect(evaluate("ROUNDUP(x, y)", { x: 1.8453, y: null })).toBe(2);
  });

  it("ceils toward positive infinity (Ruby Float#ceil parity)", () => {
    expect(evaluate("ROUNDUP(-1.8)")).toBe(-1);
    expect(evaluate("ROUNDUP(x, y)", { x: -1.8453, y: 3 })).toBe(-1.845);
  });

  it("supports negative precision", () => {
    expect(evaluate("ROUNDUP(1601, -2)")).toBe(1700);
  });

  it("raises an error if arguments are not numeric", () => {
    expect(() => evaluate('ROUNDUP("abc", 0)')).toThrow(TypeMismatchError);
    expect(() => evaluate('ROUNDUP(1.8, "abc")')).toThrow(TypeMismatchError);
  });
});

// --- spec/ast/abs_spec.rb -------------------------------------------------------

describe("ABS (spec/ast/abs_spec.rb)", () => {
  it("returns the absolute value of number", () => {
    expect(evaluate("ABS(-4.2)")).toBe(4.2);
  });

  it("returns the correct value for positive number", () => {
    expect(evaluate("ABS(1.3)")).toBe(1.3);
  });

  it("returns the correct value for zero", () => {
    expect(evaluate("ABS(0)")).toBe(0);
  });

  it("treats a bare date literal as arithmetic", () => {
    // ADR-0003.5: Ruby's ABS(2020-1-1) raised Dentaku::ArgumentError (Date arg);
    // with date literals off the argument is the number 2018.
    expect(evaluate("ABS(2020-1-1)")).toBe(2018);
  });

  it("raises an error if argument is not numeric", () => {
    expect(() => evaluate('ABS("x")')).toThrow(TypeMismatchError);
    expect(() => evaluate("ABS(true)")).toThrow(TypeMismatchError);
  });
});

// --- spec/ast/intercept_spec.rb -------------------------------------------------

describe("INTERCEPT (spec/ast/intercept_spec.rb)", () => {
  it("returns the correct intercept for given x and y arrays", () => {
    const xValues = [6, 13, 15, 10, 11, 10];
    const yValues = [-1, 8, 8, 13, 3, 15];
    // Argument order as in the Ruby spec (ys first, matching its expectation).
    const result = evaluate("INTERCEPT(ys, xs)", { xs: xValues, ys: yValues });
    expect(result).toBeCloseTo(9.437, 3);
  });

  it("raises an error if arguments are not arrays", () => {
    // Ruby: Dentaku::ArgumentError :invalid_value → TypeMismatchError.
    expect(() => evaluate("INTERCEPT(1, 2)")).toThrow(TypeMismatchError);
  });

  it("raises an error if the arrays are not of equal length", () => {
    expect(() => evaluate("INTERCEPT(y, x)", { x: [1, 2, 3], y: [2, 3, 5, 4] })).toThrow(
      TypeMismatchError,
    );
  });

  it("raises an error if any of the arrays is empty", () => {
    expect(() => evaluate("INTERCEPT(y, x)", { x: [], y: [2, 3, 5, 4] })).toThrow(
      TypeMismatchError,
    );
    expect(() => evaluate("INTERCEPT(y, x)", { x: [], y: [] })).toThrow(TypeMismatchError);
  });

  it("raises an error for wrong argument counts", () => {
    // Ruby: Dentaku::ArgumentError :wrong_number_of_arguments at eval time.
    expect(() => evaluate("INTERCEPT(x)", { x: [1, 2] })).toThrow(ArgumentCountError);
    expect(() => evaluate("INTERCEPT(x, x, x)", { x: [1, 2] })).toThrow(ArgumentCountError);
  });

  it("raises a type error for non-numeric elements", () => {
    // ADR-0003.3: Ruby coerced numeric strings inside the arrays.
    expect(() => evaluate("INTERCEPT(y, x)", { x: [1, "2"], y: [2, 3] })).toThrow(
      TypeMismatchError,
    );
  });
});

// --- cross-pack formula-level checks ---------------------------------------------

describe("numeric functions compose with logic functions", () => {
  it("nests through IF and comparators", () => {
    expect(evaluate("IF(SUM(1, 2) > 2, ROUND(2.5), 0)")).toBe(3);
    expect(evaluate("IF(MIN(x) < 0, ABS(MIN(x)), MAX(x))", { x: [-3, 1, 2] })).toBe(3);
  });

  it("functions are case-insensitive", () => {
    expect(evaluate("sum(1, 2) + Max(3, 4)")).toBe(7);
  });
});
