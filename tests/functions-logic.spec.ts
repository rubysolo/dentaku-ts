// Ported from Ruby dentaku v3.5.7: spec/ast/{and_function,or,xor,switch}_spec.rb
// and the IF cases of spec/calculator_spec.rb (spec/ast/function_spec.rb and
// spec/ast/case_spec.rb exercise the registry / CASE node, not this pack).
//
// Every deviation from Ruby behavior is annotated with its ADR tightening:
//   ADR-0003.2 strict booleans in conditionals (IF/NOT reject non-booleans)
//   ADR-0003.3 no mixed-type `=` comparisons (1 = "1" is a type error)
// Ruby-parity notes: AND/OR/XOR accept null as false; Ruby's single
// Dentaku::ArgumentError maps to ArgumentCountError (arity) or
// TypeMismatchError (type) in our taxonomy.
import { describe, expect, it } from "vitest";
import { Scope } from "../src/ast/index.js";
import type { Binding, Node } from "../src/ast/node.js";
import {
  ArgumentCountError,
  ParseError,
  TypeMismatchError,
  UnboundVariableError,
  ZeroDivisionError,
} from "../src/errors.js";
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

// --- spec/ast/and_function_spec.rb ---------------------------------------------

describe("AND (spec/ast/and_function_spec.rb)", () => {
  it("returns false if any of the arguments is false", () => {
    expect(evaluate("AND(1 = 1, 0 = 1)")).toBe(false);
  });

  it("supports nested expressions", () => {
    expect(evaluate("AND(y = 1, x = 1)", { x: 1, y: 2 })).toBe(false);
  });

  it("returns true if all of the arguments are true", () => {
    expect(evaluate('AND(1 = 1, "2" = "2", true = true, true)')).toBe(true);
  });

  it("returns true if all nested AND functions return true", () => {
    expect(evaluate("AND(AND(1 = 1), AND(true != false, AND(true)))")).toBe(true);
  });

  it("raises an error if no arguments are passed", () => {
    // Ruby: Dentaku::ArgumentError at eval time (splat lambda, no parse arity).
    expect(() => evaluate("AND()")).toThrow(ArgumentCountError);
  });

  it("raises an error if a non logical argument is passed", () => {
    // Ruby: Dentaku::ArgumentError :incompatible_type → TypeMismatchError.
    expect(() => evaluate('AND("r")')).toThrow(TypeMismatchError);
  });

  it("treats null as false (Ruby nil parity)", () => {
    expect(evaluate("AND(true, x)", { x: null })).toBe(false);
    expect(evaluate("AND(x)", { x: null })).toBe(false);
  });
});

// --- spec/ast/or_spec.rb --------------------------------------------------------

describe("OR (spec/ast/or_spec.rb)", () => {
  it("returns false if all of the arguments are false", () => {
    // ADR-0003.3: Ruby's original 'OR(1 = "2", 0 = 1)' mixed types in `=`
    // (answering false); the typed-pair form keeps the case's intent.
    expect(evaluate("OR(1 = 2, 0 = 1)")).toBe(false);
  });

  it("raises a type error for mixed-type equality inside OR", () => {
    // ADR-0003.3: the literal Ruby case is now a type error.
    expect(() => evaluate('OR(1 = "2", 0 = 1)')).toThrow(TypeMismatchError);
  });

  it("supports nested expressions", () => {
    expect(evaluate("OR(y = 1, x = 1)", { x: 1, y: 2 })).toBe(true);
  });

  it("returns true if any of the arguments is true", () => {
    // ADR-0003.3: Ruby's '1 = "1"' arm replaced with a typed pair.
    expect(evaluate('OR(1 = 1, "2" = "2", true = false, false)')).toBe(true);
  });

  it("returns true if any nested OR function returns true", () => {
    expect(evaluate("OR(OR(1 = 0), OR(true = false, OR(true)))")).toBe(true);
  });

  it("raises an error if no arguments are passed", () => {
    // Ruby: Dentaku::ArgumentError at eval time.
    expect(() => evaluate("OR()")).toThrow(ArgumentCountError);
  });

  it("raises an error if a non logical argument is passed", () => {
    expect(() => evaluate('OR("r")')).toThrow(TypeMismatchError);
  });

  it("treats null as false (Ruby nil parity)", () => {
    expect(evaluate("OR(false, x)", { x: null })).toBe(false);
    expect(evaluate("OR(true, x)", { x: null })).toBe(true);
  });
});

// --- spec/ast/xor_spec.rb -------------------------------------------------------

describe("XOR (spec/ast/xor_spec.rb)", () => {
  it("returns false if all of the arguments are false", () => {
    expect(evaluate("XOR(false, false)")).toBe(false);
  });

  it("returns true if only one of the arguments is true", () => {
    expect(evaluate("XOR(false, true)")).toBe(true);
  });

  it("returns false if more than one of the arguments is true", () => {
    expect(evaluate("XOR(false, true, true)")).toBe(false);
  });

  it("supports nested expressions", () => {
    expect(evaluate("XOR(y = 1, x = 1)", { x: 1, y: 2 })).toBe(true);
  });

  it("raises an error if no arguments are passed", () => {
    // Ruby parity: XOR is class-registered with min_param_count 1, so the
    // empty call fails at parse time (Dentaku::ParseError), unlike AND()/OR().
    expect(() => evaluate("XOR()")).toThrow(ParseError);
  });

  it("raises an error if a non logical argument is passed", () => {
    expect(() => evaluate('XOR("r")')).toThrow(TypeMismatchError);
  });

  it("treats null as false (Ruby nil parity)", () => {
    expect(evaluate("XOR(x, true)", { x: null })).toBe(true);
    expect(evaluate("XOR(x, true, true)", { x: null })).toBe(false);
  });
});

// --- NOT (lib/dentaku/ast/functions/not.rb; no Ruby spec file) ------------------

describe("NOT", () => {
  it("negates a boolean argument", () => {
    expect(evaluate("NOT(true)")).toBe(false);
    expect(evaluate("NOT(false)")).toBe(true);
    expect(evaluate("NOT(1 = 2)")).toBe(true);
  });

  it("rejects non-boolean arguments", () => {
    // ADR-0003.2: Ruby's NOT used bare truthiness (NOT(1) → false, NOT(null) → true).
    expect(() => evaluate("NOT(1)")).toThrow(TypeMismatchError);
    expect(() => evaluate("NOT(x)", { x: null })).toThrow(TypeMismatchError);
    expect(() => evaluate('NOT("r")')).toThrow(TypeMismatchError);
  });

  it("requires exactly one argument", () => {
    expect(() => evaluate("NOT()")).toThrow(ParseError);
    expect(() => evaluate("NOT(true, false)")).toThrow(ParseError);
  });
});

// --- spec/ast/switch_spec.rb ----------------------------------------------------

describe("SWITCH (spec/ast/switch_spec.rb)", () => {
  it("returns the match if present in arguments", () => {
    expect(evaluate('SWITCH(1, 1, "one", 2, "two")')).toBe("one");
  });

  it("returns nil if no match was found", () => {
    expect(evaluate('SWITCH(3, 1, "one", 2, "two")')).toBeNull();
  });

  it("returns the default value if present and no match was found", () => {
    expect(evaluate('SWITCH(3, 1, "one", 2, "two", "no match")')).toBe("no match");
  });

  it("returns the first match if multiple matches exist", () => {
    expect(evaluate('SWITCH(1, 1, "one", 2, "two", 1, "three")')).toBe("one");
  });

  it("does not return a match where a value matches the search value", () => {
    // Mixed-type pair matching answers false (Ruby `==` parity via looseEquals);
    // it is NOT a type error, unlike the `=` comparator (ADR-0003.3).
    expect(evaluate('SWITCH(1, "one", 1, 2, "two", 3)')).toBe(3);
  });

  it("matches values bound from context", () => {
    expect(evaluate('SWITCH(x, "a", 1, "b", 2)', { x: "b" })).toBe(2);
  });
});

// --- IF cases from spec/calculator_spec.rb --------------------------------------

describe("IF (spec/calculator_spec.rb function cases)", () => {
  it("evaluates the taken branch based on the predicate", () => {
    expect(evaluate("if(foo < 8, 10, 20)", { foo: 2 })).toBe(10);
    expect(evaluate("if(foo < 8, 10, 20)", { foo: 9 })).toBe(20);
    expect(evaluate("IF(true, 1, 2)")).toBe(1);
    expect(evaluate("IF(false, 1, 2)")).toBe(2);
  });

  it("raises for unbound predicate variables", () => {
    expect(() => evaluate("IF(a, 1, 0)")).toThrow(UnboundVariableError);
  });

  it("raises a ParseError for wrong argument counts", () => {
    expect(() => evaluate("IF(a, b)", { a: true, b: 1 })).toThrow(ParseError);
    expect(() => evaluate("IF(true, 1, 2, 3)")).toThrow(ParseError);
  });

  it("requires a boolean predicate", () => {
    // ADR-0003.2: Ruby treated any truthy predicate as true — IF(1, 2, 3) was 2,
    // IF(null, 1, 2) was 2, and IF(a, 1, 0) with a: nil was 0.
    expect(() => evaluate("IF(1, 2, 3)")).toThrow(TypeMismatchError);
    expect(() => evaluate("IF(null, 1, 2)")).toThrow(TypeMismatchError);
    expect(() => evaluate("IF(a, 1, 0)", { a: null })).toThrow(TypeMismatchError);
    expect(() => evaluate('IF("yes", 1, 0)')).toThrow(TypeMismatchError);
  });

  it("evaluates only the taken branch (special form laziness)", () => {
    expect(evaluate("IF(true, 1, 1/0)")).toBe(1);
    expect(evaluate("IF(false, missing, 2)")).toBe(2);
    // Contrast: the taken branch's errors do surface.
    expect(() => evaluate("IF(false, 1, 1/0)")).toThrow(ZeroDivisionError);
    expect(() => evaluate("IF(true, missing, 2)")).toThrow(UnboundVariableError);
  });

  describe("dependencies (Ruby ast/functions/if.rb short-circuit)", () => {
    it("reports the union of all arguments when the predicate cannot be evaluated", () => {
      expect(ast("IF(a, b, c)").dependencies()).toEqual(["a", "b", "c"]);
      expect(ast("IF(a > 1, b, c)").dependencies(context({}))).toEqual(["a", "b", "c"]);
    });

    it("short-circuits to the taken branch when the predicate evaluates", () => {
      expect(ast("IF(a, b, c)").dependencies(context({ a: true }))).toEqual(["b"]);
      expect(ast("IF(a, b, c)").dependencies(context({ a: false }))).toEqual(["c"]);
      expect(ast("IF(a > 1, b, c)").dependencies(context({ a: 5 }))).toEqual(["b"]);
    });

    it("falls back to the union when the predicate is not boolean", () => {
      // ADR-0003.2: Ruby short-circuited on truthiness (a: 1 reported ['b']);
      // a non-boolean predicate throws TypeMismatchError inside the probe, so
      // the reported set is the rescue-path union.
      expect(ast("IF(a, b, c)").dependencies(context({ a: 1 }))).toEqual(["b", "c"]);
    });
  });
});
