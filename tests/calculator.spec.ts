// Ported from Ruby dentaku v3.5.7 spec/calculator_spec.rb (issue 011).
//
// Method mapping (ADR-0002): Ruby `evaluate!` cases → `evaluate` (throws typed
// errors); Ruby `evaluate` nil-on-error cases → `tryEvaluate` (undefined on
// DentakuError only). Every behavioral deviation from Ruby carries its ADR
// annotation:
//   ADR-0003.1 case-sensitive identifiers (caseInsensitiveIdentifiers opt-in)
//   ADR-0003.2 strict booleans in conditionals
//   ADR-0003.3 no string→number coercion in arithmetic
//   ADR-0003.4 conventional bitwise precedence
//   ADR-0003.5 bare date literals off by default (dateLiterals opt-in)
//   ADR-0004   civil dates: no string→date coercion; date ± number counts days
// Ruby-only host surface (global registry, aliases, block-form store/evaluate,
// array-of-formulas evaluate, solve/solve! — issue 012) is skipped with a
// citing comment at each site.
import { describe, expect, it } from "vitest";
import {
  Calculator,
  CivilDateTime,
  Decimal,
  MathDomainError,
  evaluate as moduleEvaluate,
  tryEvaluate as moduleTryEvaluate,
  ParseError,
  TypeMismatchError,
  UnboundVariableError,
  ZeroDivisionError,
} from "../src/index.js";

const calc = () => new Calculator();
const utc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, second));

describe("Calculator", () => {
  it("evaluates an expression", () => {
    const c = calc();
    expect(c.evaluate("7+3")).toBe(10);
    expect(c.evaluate("2 -1")).toBe(1);
    expect(c.evaluate("-1 + 2")).toBe(1);
    expect(c.evaluate("1 - 2")).toBe(-1);
    expect(c.evaluate("1 - - 2")).toBe(3);
    expect(c.evaluate("-1 - - 2")).toBe(1);
    expect(c.evaluate("1 - - - 2")).toBe(-1);
    expect(c.evaluate("(-1 + 2)")).toBe(1);
    expect(c.evaluate("-(1 + 2)")).toBe(-3);
    expect(c.evaluate("2 ^ - 1")).toBe(0.5);
    expect(c.evaluate("2 ^ -(3 - 2)")).toBe(0.5);
    expect(c.evaluate("(2 + 3) - 1")).toBe(4);
    expect(c.evaluate("(-2 + 3) - 1")).toBe(0);
    expect(c.evaluate("(-2 - 3) - 1")).toBe(-6);
    expect(c.evaluate("1353+91-1-3322-22")).toBe(-1901);
    expect(c.evaluate("1 + -(2 ^ 2)")).toBe(-3);
    expect(c.evaluate("3 + -num", { num: 2 })).toBe(1);
    expect(c.evaluate("-num + 3", { num: 2 })).toBe(1);
    expect(c.evaluate("10 ^ 2")).toBe(100);
    expect(c.evaluate("0 * 10 ^ -5")).toBe(0);
    expect(c.evaluate("3 + 0 * -3")).toBe(3);
    expect(c.evaluate("3 + 0 / -3")).toBe(3);
    expect(c.evaluate("(((695759/735000)^(1/(1981-1991)))-1)*1000")).toBeCloseTo(5.5018, 4);
    expect(c.evaluate("0.253/0.253")).toBe(1);
    expect(c.evaluate("0.253/d", { d: 0.253 })).toBe(1);
    expect(c.tryEvaluate("10 + x", { x: "abc" })).toBeUndefined();
    // ADR-0003.3: Ruby coerced numeric strings from context at eval time
    // ('x * y', x: '.123', y: '100' → 12.3); no string→number coercion here.
    expect(() => c.evaluate("x * y", { x: ".123", y: "100" })).toThrow(TypeMismatchError);
    expect(() => c.evaluate("a/b", { a: "10", b: "2" })).toThrow(TypeMismatchError);
    // ADR-0004: Ruby's Time arithmetic counted seconds ('t + 1*24*60*60');
    // civil date ± number counts days.
    expect(c.evaluate("t + 1", { t: utc(2017, 1, 1) })).toEqual(utc(2017, 1, 2));
    // ADR-0003.4: conventional bitwise precedence (results coincide with
    // Ruby's precedence-0 quirk on these inputs).
    expect(c.evaluate("2 | 3 * 9")).toBe(27);
    expect(c.evaluate("2 & 3 * 9")).toBe(2);
    expect(c.evaluate("1 << 3")).toBe(8);
    expect(c.evaluate("0xFF >> 6")).toBe(3);
  });

  it("differentiates between percentage and modulo operators", () => {
    const c = calc();
    expect(c.evaluate("15 % 8")).toBe(7);
    expect(c.evaluate("15 % (4 * 2)")).toBe(7);
    expect(c.evaluate("5%")).toBe(0.05);
    expect(c.evaluate("400/60%")).toBeCloseTo(666.67, 2);
    expect(c.evaluate("(400/60%)*1")).toBeCloseTo(666.67, 2);
    expect(c.evaluate("60% * 1")).toBe(0.6);
    expect(c.evaluate("50% + 50%")).toBe(1.0);
  });

  // Ruby `evaluate` (nil on error) → tryEvaluate (ADR-0002).
  describe("tryEvaluate", () => {
    it("returns undefined when formula has error", () => {
      expect(calc().tryEvaluate("1 + + 1")).toBeUndefined();
    });

    it("suppresses unbound variable errors", () => {
      const c = calc();
      expect(c.tryEvaluate("AND(a,b)")).toBeUndefined();
      expect(c.tryEvaluate("IF(a, 1, 0)")).toBeUndefined();
      expect(c.tryEvaluate("MAX(a,b)")).toBeUndefined();
      expect(c.tryEvaluate("MIN(a,b)")).toBeUndefined();
      expect(c.tryEvaluate("NOT(a)")).toBeUndefined();
      expect(c.tryEvaluate("OR(a,b)")).toBeUndefined();
      expect(c.tryEvaluate("ROUND(a)")).toBeUndefined();
      expect(c.tryEvaluate("ROUNDDOWN(a)")).toBeUndefined();
      expect(c.tryEvaluate("ROUNDUP(a)")).toBeUndefined();
      expect(c.tryEvaluate("SUM(a,b)")).toBeUndefined();
    });

    it("suppresses numeric coercion errors", () => {
      const c = calc();
      expect(c.tryEvaluate("MAX(a,b)", { a: null, b: null })).toBeUndefined();
      expect(c.tryEvaluate("MIN(a,b)", { a: null, b: null })).toBeUndefined();
      expect(c.tryEvaluate("ROUND(a)", { a: null })).toBeUndefined();
      expect(c.tryEvaluate("ROUNDDOWN(a)", { a: null })).toBeUndefined();
      expect(c.tryEvaluate("ROUNDUP(a)", { a: null })).toBeUndefined();
      expect(c.tryEvaluate("SUM(a,b)", { a: null, b: null })).toBeUndefined();
      expect(c.tryEvaluate('1.0 & "bar"')).toBeUndefined();
    });

    it("treats explicit null as logical false in AND/OR (Ruby parity)", () => {
      const c = calc();
      expect(c.tryEvaluate("AND(a,b)", { a: null, b: null })).toBe(false);
      expect(c.tryEvaluate("OR(a,b)", { a: null, b: null })).toBe(false);
      // ADR-0003.2: IF and NOT require boolean operands; Ruby treated nil as
      // false (IF(a,1,0) → 0, NOT(a) → true).
      expect(() => c.evaluate("IF(a,1,0)", { a: null, b: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate("NOT(a)", { a: null, b: null })).toThrow(TypeMismatchError);
      expect(c.tryEvaluate("IF(a,1,0)", { a: null, b: null })).toBeUndefined();
      expect(c.tryEvaluate("NOT(a)", { a: null, b: null })).toBeUndefined();
    });

    it("supports lazy evaluation of variables", () => {
      const c = calc();
      expect(c.evaluate("x + 1", { x: () => 1 })).toBe(2);
      expect(() =>
        c.evaluate("2", {
          x: () => {
            throw new Error("boom");
          },
        }),
      ).not.toThrow();
    });

    it("runs enum functions permissively (per-item DentakuErrors → null in map)", () => {
      const c = calc();
      // Strict mode (evaluate): the per-item error propagates.
      expect(() => c.evaluate("map(xs, x, 10 / x)", { xs: [1, 0] })).toThrow(ZeroDivisionError);
      // Permissive mode (tryEvaluate): map swallows per-item DentakuErrors
      // (Ruby __evaluation_mode :permissive parity).
      expect(c.tryEvaluate("map(xs, x, 10 / x)", { xs: [1, 0] })).toEqual([10, null]);
    });

    it("propagates non-Dentaku errors (bugs) instead of swallowing them", () => {
      // ADR-0002: tryEvaluate catches exactly DentakuError subclasses.
      const c = calc();
      c.addFunction({
        name: "boom",
        returnType: "numeric",
        fn: () => {
          throw new RangeError("bug!");
        },
      });
      expect(() => c.tryEvaluate("BOOM()")).toThrow(RangeError);
    });
  });

  describe("ast", () => {
    it("raises parsing errors", () => {
      // Ruby raises Dentaku::ParseError / Dentaku::TokenizerError; the error
      // taxonomy folds tokenizer failures into ParseError (PLAN.md).
      expect(() => calc().ast("()")).toThrow(ParseError);
      expect(() => calc().ast("(}")).toThrow(ParseError);
    });

    it("returns a Node argument unchanged (Ruby parity)", () => {
      const c = calc();
      const node = c.ast("1 + 1");
      expect(c.ast(node)).toBe(node);
    });
  });

  // Ruby `evaluate!` → evaluate (ADR-0002).
  describe("evaluate", () => {
    it("raises exception when formula has error", () => {
      expect(() => calc().evaluate("1 + + 1")).toThrow(ParseError);
      expect(() => calc().evaluate('(1 > 5) OR LEFT("abc", 1)')).toThrow(ParseError);
    });

    it("raises unbound variable errors", () => {
      const c = calc();
      expect(() => c.evaluate("AND(a,b)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("IF(a, 1, 0)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("MAX(a,b)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("MIN(a,b)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("NOT(a)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("OR(a,b)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("ROUND(a)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("ROUNDDOWN(a)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("ROUNDUP(a)")).toThrow(UnboundVariableError);
      expect(() => c.evaluate("SUM(a,b)")).toThrow(UnboundVariableError);
    });

    it("raises numeric coercion errors", () => {
      // Ruby raised Dentaku::ArgumentError; the taxonomy calls these
      // TypeMismatchError (PLAN.md error taxonomy; same category, new name).
      const c = calc();
      expect(() => c.evaluate("MAX(a,b)", { a: null, b: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate("MIN(a,b)", { a: null, b: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate("ROUND(a)", { a: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate("ROUNDDOWN(a)", { a: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate("ROUNDUP(a)", { a: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate("SUM(a,b)", { a: null, b: null })).toThrow(TypeMismatchError);
      expect(() => c.evaluate('"foo" & "bar"')).toThrow(TypeMismatchError);
      expect(() => c.evaluate('1.0 & "bar"')).toThrow(TypeMismatchError);
      expect(() => c.evaluate('1 & "bar"')).toThrow(TypeMismatchError);
      expect(() => c.evaluate("data < 1", { data: { a: 5 } })).toThrow(TypeMismatchError);
    });

    it("raises a parse error if a function is called with incorrect arity", () => {
      expect(() => calc().evaluate("IF(a,b)", { a: 1, b: 1 })).toThrow(ParseError);
    });

    it("checks dependencies before evaluating anything", () => {
      // The unbound-variable check runs first, even when evaluation would
      // raise a different error.
      expect(() => calc().evaluate("b + 1/0")).toThrow(UnboundVariableError);
    });

    it("attaches the formula to thrown errors", () => {
      let caught: unknown;
      try {
        calc().evaluate("1/0");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ZeroDivisionError);
      expect((caught as ZeroDivisionError).formula).toBe("1/0");
    });
  });

  // Ruby: 'supports unicode characters in identifiers' (ρ * 2). The identifier
  // scanner is Unicode-aware like Ruby's POSIX word class.
  it("supports bare unicode characters in identifiers", () => {
    expect(calc().evaluate("ρ * 2", { ρ: 2 })).toBe(4);
  });

  it("supports unicode characters in quoted identifiers", () => {
    expect(calc().evaluate("`ρ` * 2", { ρ: 2 })).toBe(4);
  });

  describe("memory", () => {
    // Ruby's `empty?` accessor has no TS equivalent; emptiness is asserted
    // through unbound-variable behavior instead.
    it("discards local values", () => {
      const c = calc();
      expect(c.evaluate("pears * 2", { pears: 5 })).toBe(10);
      expect(() => c.evaluate("pears * 2")).toThrow(UnboundVariableError);
    });

    it("can store the value false", () => {
      const c = calc();
      c.store("i_am_false", false);
      expect(c.evaluate("i_am_false")).toBe(false);
    });

    it("can store multiple values", () => {
      const c = calc();
      c.store({ first: 1, second: 2 });
      expect(c.evaluate("first")).toBe(1);
      expect(c.evaluate("second")).toBe(2);
    });

    it("clears stored values", () => {
      const c = calc().store({ apples: 3 });
      expect(c.evaluate("apples")).toBe(3);
      c.clear();
      expect(() => c.evaluate("apples")).toThrow(UnboundVariableError);
    });

    it("stores formulas", () => {
      const c = calc();
      c.storeFormula("area", "length * width");
      expect(c.evaluate("area", { length: 5, width: 5 })).toBe(25);
    });

    it("stores dates", () => {
      // Ruby asserts via solve (issue 012); the arithmetic itself is the point.
      const c = calc();
      c.store("d1", utc(2024, 1, 2));
      c.store("d2", utc(2024, 1, 6));
      expect(c.evaluate("d1 - d2")).toBe(-4);
    });

    it("stores nested hashes", () => {
      const c = calc();
      c.store({ a: { basket: { of: "apples" } }, b: 2 });
      expect(c.evaluate("a.basket.of")).toBe("apples");
      expect(c.evaluate("a.basket")).toEqual({ of: "apples" });
      expect(c.evaluate("b")).toBe(2);
    });

    it("stores nested hashes with quotes", () => {
      const c = calc();
      c.store({ a: { basket: { of: "apples" } }, b: 2 });
      expect(c.evaluate("`a.basket.of`")).toBe("apples");
      expect(c.evaluate("`a.basket`")).toEqual({ of: "apples" });
      expect(c.evaluate("`b`")).toBe(2);
    });

    it("flattens nested values in the single-key store form too", () => {
      // Deliberate divergence from Ruby, which only flattened the object form;
      // documented on Calculator#store.
      const c = calc();
      c.store("a", { basket: { of: "apples" } });
      expect(c.evaluate("a.basket.of")).toBe("apples");
    });

    it("stores arrays", () => {
      const c = calc();
      c.store({ a: [1, 2, 3] });
      expect(c.evaluate("a[0]")).toBe(1);
      expect(c.evaluate("a[x]", { x: 1 })).toBe(2);
      expect(c.evaluate("a[x+1]", { x: 1 })).toBe(3);
    });

    it("evaluates array literals", () => {
      // Ruby's evaluate([1, 2, 3]) array-of-formulas overload is removed
      // (PLAN.md "Removals": callers can .map); the literal form remains.
      expect(calc().evaluate("{1,2,3}")).toEqual([1, 2, 3]);
    });

    it("is never mutated by evaluation or by caller objects", () => {
      const vars = { nested: { x: 2 }, n: 1 };
      const c = calc();
      c.store(vars);
      vars.nested.x = 99; // mutating the caller's object must not affect memory
      expect(c.evaluate("nested.x")).toBe(2);
      expect(vars).toEqual({ nested: { x: 99 }, n: 1 });
    });
  });

  describe("dependencies", () => {
    it("respects quoted identifiers in dependencies", () => {
      expect(calc().dependencies("`bob the builder` + `dole the digger` / 3")).toEqual([
        "bob the builder",
        "dole the digger",
      ]);
    });

    it("finds dependencies in a generic statement", () => {
      expect(calc().dependencies("bob + dole / 3")).toEqual(["bob", "dole"]);
    });

    it("ignores dependencies passed in context", () => {
      expect(calc().dependencies("a + b", { a: 1 })).toEqual(["b"]);
    });

    it("ignores dependencies passed in context for quoted identifiers", () => {
      expect(calc().dependencies("`a-c` + b", { "a-c": 1 })).toEqual(["b"]);
    });

    it("finds dependencies in formula arguments", () => {
      expect(calc().dependencies("CONCAT(bob, dole)")).toEqual(["bob", "dole"]);
    });

    it("doesn't consider variables in memory as dependencies", () => {
      expect(calc().store({ apples: 3 }).dependencies("apples + oranges")).toEqual(["oranges"]);
    });

    it("finds no dependencies in array literals", () => {
      // Ruby passes a raw array (removed overload); the literal form is ported.
      expect(calc().dependencies("{1, 2, 3}")).toEqual([]);
    });

    it("finds dependencies in item expressions", () => {
      expect(calc().dependencies("MAP(vals, val, val + step)")).toEqual(["vals", "step"]);
      expect(calc().dependencies("ALL(people, person, person.age < adult)")).toEqual([
        "people",
        "adult",
      ]);
    });

    it("sees through stored formulas", () => {
      const c = calc();
      c.storeFormula("area", "length * width");
      expect(c.dependencies("area + 1")).toEqual(["length", "width"]);
    });

    it("raises an error when trying to find dependencies with invalid syntax", () => {
      const c = calc();
      expect(() => c.dependencies("bob + / 3")).toThrow(ParseError);
      expect(() => c.dependencies("123 * TRUE")).toThrow(ParseError);
      expect(() => c.dependencies('4 + "asdf"')).toThrow(ParseError);
    });
  });

  // Ruby: describe 'solve!' / describe 'solve' — bulk solving is issue 012
  // (Calculator#solve/trySolve); not ported here.

  it("evaluates a statement with no variables", () => {
    const c = calc();
    expect(c.evaluate("5+3")).toBe(8);
    expect(c.evaluate("(1+1+1)/3*100")).toBe(100);
  });

  it("evaluates negation", () => {
    const c = calc();
    expect(c.evaluate("-negative", { negative: -1 })).toBe(1);
    // ADR-0003.3: Ruby coerced string variables ('-1') to numbers; negation of
    // a string is a type error here.
    expect(() => c.evaluate("-negative", { negative: "-1" })).toThrow(TypeMismatchError);
    expect(() => c.evaluate("-negative - 1", { negative: "-1" })).toThrow(TypeMismatchError);
    expect(() => c.evaluate("-negative - 1", { negative: "1" })).toThrow(TypeMismatchError);
    expect(() => c.evaluate("-(negative) - 1", { negative: "1" })).toThrow(TypeMismatchError);
  });

  it("fails to evaluate unbound statements", () => {
    const unbound = "foo * 1.5";
    const c = calc();
    expect(() => c.evaluate(unbound)).toThrow(UnboundVariableError);
    let error: unknown;
    try {
      c.evaluate(unbound);
    } catch (e) {
      error = e;
    }
    expect((error as UnboundVariableError).unboundVariables).toEqual(["foo"]);
    expect((error as UnboundVariableError).message).toBe("no value provided for variables: foo");
    try {
      c.evaluate("a + b");
    } catch (e) {
      error = e;
    }
    expect((error as UnboundVariableError).unboundVariables).toEqual(["a", "b"]);
    expect((error as UnboundVariableError).message).toBe("no value provided for variables: a, b");
    expect(c.tryEvaluate(unbound)).toBeUndefined();
  });

  // Ruby: 'accepts a block for custom handling of unbound variables' — the
  // block form is Ruby-only surface (callers branch on tryEvaluate/catch).

  it("fails to evaluate incomplete statements", () => {
    for (const statement of ["true AND", "a a ^&"]) {
      expect(() => calc().evaluate(statement)).toThrow(ParseError);
    }
  });

  it("evaluates unbound statements given a binding in memory", () => {
    const c = calc();
    expect(c.evaluate("foo * 1.5", { foo: 2 })).toBe(3);
    // Ruby's `bind` is an alias of `store`.
    expect(c.store({ monkeys: 3 }).evaluate("monkeys < 7")).toBe(true);
    expect(c.evaluate("monkeys / 1.5")).toBe(2);
  });

  it("rebinds for each evaluation", () => {
    const c = calc();
    expect(c.evaluate("foo * 2", { foo: 2 })).toBe(4);
    expect(c.evaluate("foo * 2", { foo: 4 })).toBe(8);
  });

  // Ruby: 'accepts strings or symbols for binding keys' — symbols are
  // Ruby-only; JS object keys are always strings.

  it("accepts digits in identifiers", () => {
    const c = calc();
    expect(c.evaluate("foo1 * 2", { foo1: 2 })).toBe(4);
    expect(c.evaluate("foo1 * 2", { foo1: 4 })).toBe(8);
    expect(c.evaluate("1foo * 2", { "1foo": 2 })).toBe(4);
    expect(c.evaluate("fo1o * 2", { fo1o: 4 })).toBe(8);
  });

  it("accepts special characters in quoted identifiers", () => {
    const c = calc();
    expect(c.evaluate("`foo1 bar` * 2", { "foo1 bar": 2 })).toBe(4);
    expect(c.evaluate("`foo1-bar` * 2", { "foo1-bar": 4 })).toBe(8);
    expect(c.evaluate("`1foo (bar)` * 2", { "1foo (bar)": 2 })).toBe(4);
    expect(c.evaluate("`fo1o *bar*` * 2", { "fo1o *bar*": 4 })).toBe(8);
  });

  it("compares string literals with string variables", () => {
    const c = calc();
    expect(c.evaluate('fruit = "apple"', { fruit: "apple" })).toBe(true);
    expect(c.evaluate('fruit = "apple"', { fruit: "pear" })).toBe(false);
  });

  it("performs case-sensitive comparison", () => {
    const c = calc();
    expect(c.evaluate('fruit = "Apple"', { fruit: "apple" })).toBe(false);
    expect(c.evaluate('fruit = "Apple"', { fruit: "Apple" })).toBe(true);
  });

  it("allows binding logical values", () => {
    const c = calc();
    expect(c.evaluate("some_boolean AND 7 > 5", { some_boolean: true })).toBe(true);
    expect(c.evaluate("some_boolean AND 7 < 5", { some_boolean: true })).toBe(false);
    expect(c.evaluate("some_boolean AND 7 > 5", { some_boolean: false })).toBe(false);

    expect(c.evaluate("some_boolean OR 7 > 5", { some_boolean: true })).toBe(true);
    expect(c.evaluate("some_boolean OR 7 < 5", { some_boolean: true })).toBe(true);
    expect(c.evaluate("some_boolean OR 7 < 5", { some_boolean: false })).toBe(false);
  });

  it("compares time variables", () => {
    const c = calc();
    expect(c.evaluate("t1 < t2", { t1: utc(2017, 1, 1), t2: utc(2017, 1, 2) })).toBe(true);
    expect(c.evaluate("t1 < t2", { t1: utc(2017, 1, 2), t2: utc(2017, 1, 1) })).toBe(false);
    expect(c.evaluate("t1 > t2", { t1: utc(2017, 1, 1), t2: utc(2017, 1, 2) })).toBe(false);
    expect(c.evaluate("t1 > t2", { t1: utc(2017, 1, 2), t2: utc(2017, 1, 1) })).toBe(true);
  });

  it("compares time literals with time variables", () => {
    // ADR-0003.5: bare date literals require the dateLiterals option (Ruby
    // default-on raw_date_literals).
    const c = new Calculator({ dateLiterals: true });
    expect(c.evaluate("t1 < 2017-01-02", { t1: utc(2017, 1, 1) })).toBe(true);
    expect(c.evaluate("t1 < 2017-01-02", { t1: utc(2017, 1, 3) })).toBe(false);
    expect(c.evaluate("t1 > 2017-01-02", { t1: utc(2017, 1, 1) })).toBe(false);
    expect(c.evaluate("t1 > 2017-01-02", { t1: utc(2017, 1, 3) })).toBe(true);
  });

  describe("date literals disabled (the default)", () => {
    it("does not parse formulas with minus signs as dates", () => {
      // ADR-0003.5: this is the default here; Ruby needed
      // raw_date_literals: false to get arithmetic.
      expect(calc().evaluate("2020-01-01")).toBe(2018);
    });
  });

  describe("supports date arithmetic", () => {
    // ADR-0003.5: all bare-literal cases run with dateLiterals: true.
    const dateCalc = () => new Calculator({ dateLiterals: true });

    it("from hardcoded string", () => {
      const c = dateCalc();
      expect(c.evaluate("2020-01-01 + 30")).toEqual(utc(2020, 1, 31));
      expect(c.evaluate("2020-01-01 - 1")).toEqual(utc(2019, 12, 31));
      expect(c.evaluate("2020-01-01 - 2019-12-31")).toBe(1);
      expect(c.evaluate("2020-01-01 + duration(1, day)")).toEqual(utc(2020, 1, 2));
      expect(c.evaluate("2020-01-01 - duration(1, day)")).toEqual(utc(2019, 12, 31));
      expect(c.evaluate("2020-01-01 + duration(30, days)")).toEqual(utc(2020, 1, 31));
      expect(c.evaluate("2020-01-01 + duration(1, month)")).toEqual(utc(2020, 2, 1));
      expect(c.evaluate("2020-01-01 - duration(1, month)")).toEqual(utc(2019, 12, 1));
      expect(c.evaluate("2020-01-01 + duration(30, months)")).toEqual(utc(2022, 7, 1));
      expect(c.evaluate("2020-01-01 + duration(1, year)")).toEqual(utc(2021, 1, 1));
      expect(c.evaluate("2020-01-01 - duration(1, year)")).toEqual(utc(2019, 1, 1));
      expect(c.evaluate("2020-01-01 + duration(30, years)")).toEqual(utc(2050, 1, 1));
    });

    it("from string variable", () => {
      // ADR-0004: no string→date coercion (Ruby parsed '2023-01-01' + duration).
      const c = calc();
      expect(() => c.evaluate("value + duration(1, month)", { value: "2023-01-01" })).toThrow(
        TypeMismatchError,
      );
      // The successor spelling: construct the date explicitly.
      expect(c.evaluate("DATE(value) + duration(1, month)", { value: "2023-01-01" })).toEqual(
        utc(2023, 2, 1),
      );
      expect(
        c.evaluate("DATE(value) - DATE(value2)", { value: "2023-01-01", value2: "2022-12-31" }),
      ).toBe(1);
    });

    it("from date object", () => {
      const c = calc();
      const value = utc(2023, 1, 1);
      const value2 = utc(2022, 12, 31);
      expect(c.evaluate("value + duration(1, month)", { value })).toEqual(utc(2023, 2, 1));
      expect(c.evaluate("value - duration(1, month)", { value })).toEqual(utc(2022, 12, 1));
      expect(c.evaluate("value - value2", { value, value2 })).toBe(1);
    });

    it("from date-time object", () => {
      const c = calc();
      const value = utc(2023, 7, 13, 10, 42, 11);
      const value2 = utc(2023, 12, 1, 9, 42, 10);
      expect(c.evaluate("value + duration(1, month)", { value })).toEqual(
        utc(2023, 8, 13, 10, 42, 11),
      );
      expect(c.evaluate("value - duration(1, day)", { value })).toEqual(
        utc(2023, 7, 12, 10, 42, 11),
      );
      expect(c.evaluate("value - duration(1, year)", { value })).toEqual(
        utc(2022, 7, 13, 10, 42, 11),
      );
      // ADR-0004: date − date counts days (Ruby's Time − Time counted seconds).
      expect(c.evaluate("value2 - value", { value, value2 })).toBeCloseTo(140.9583217, 6);
      // ADR-0004: date ± number counts days (Ruby's Time ± number counted
      // seconds; 'value - 7200' becomes 'value - 1' for one day).
      expect(c.evaluate("value - 1", { value })).toEqual(utc(2023, 7, 12, 10, 42, 11));
    });
  });

  describe("functions", () => {
    it("include IF", () => {
      const c = calc();
      expect(c.evaluate("if(foo < 8, 10, 20)", { foo: 2 })).toBe(10);
      expect(c.evaluate("if(foo < 8, 10, 20)", { foo: 9 })).toBe(20);
      expect(c.evaluate("if (foo < 8, 10, 20)", { foo: 2 })).toBe(10);
      expect(c.evaluate("if (foo < 8, 10, 20)", { foo: 9 })).toBe(20);
    });

    it("include ROUND", () => {
      const c = calc();
      expect(c.evaluate("round(8.2)")).toBe(8);
      expect(c.evaluate("round(8.8)")).toBe(9);
      expect(c.evaluate("round(8.75, 1)")).toBe(8.8);
      expect(c.evaluate("ROUND(apples * 0.93)", { apples: 10 })).toBe(9);
    });

    it("include ABS", () => {
      const c = calc();
      expect(c.evaluate("abs(-2.2)")).toBe(2.2);
      expect(c.evaluate("abs(5)")).toBe(5);
      expect(c.evaluate("ABS(x * -1)", { x: 10 })).toBe(10);
    });

    it("include NOT", () => {
      const c = calc();
      expect(c.evaluate("NOT(some_boolean)", { some_boolean: true })).toBe(false);
      expect(c.evaluate("NOT(some_boolean)", { some_boolean: false })).toBe(true);
      expect(c.evaluate("NOT(some_boolean) AND 7 > 5", { some_boolean: true })).toBe(false);
      expect(c.evaluate("NOT(some_boolean) OR 7 < 5", { some_boolean: false })).toBe(true);
    });

    it("evaluates functions with negative numbers", () => {
      const c = calc();
      expect(c.evaluate("if (-1 < 5, -1, 5)")).toBe(-1);
      expect(c.evaluate("if (-1 = -1, -1, 5)")).toBe(-1);
      expect(c.evaluate("round(-1.23, 1)")).toBe(-1.2);
      expect(c.evaluate("NOT(some_boolean) AND -1 > 3", { some_boolean: true })).toBe(false);
    });

    it("calculates intercept correctly", () => {
      const result = calc().evaluate("INTERCEPT(x_values, y_values)", {
        x_values: [1, 2, 3, 4, 5],
        y_values: [2, 3, 5, 4, 6],
      });
      expect(result).toBeCloseTo(1.3, 3);
    });

    describe("any", () => {
      it("enumerates values and returns true if any evaluation is truthy", () => {
        const c = calc();
        const users = [
          { name: "Bob", age: 44 },
          { name: "Jane", age: 27 },
        ];
        expect(c.evaluate("any(xs, x, x > 3)", { xs: [1, 2, 3, 4] })).toBe(true);
        expect(c.evaluate("any(xs, x, x > 3)", { xs: 3 })).toBe(false);
        expect(c.evaluate("any({1,2,3,4}, x, x > 3)")).toBe(true);
        expect(c.evaluate("any({1,2,3,4}, x, x > 10)")).toBe(false);
        expect(c.evaluate("any(users, u, u.age > 33)", { users })).toBe(true);
        expect(c.evaluate("any(users, u, u.age < 18)", { users })).toBe(false);
      });
    });

    describe("all", () => {
      it("enumerates values and returns true if all evaluations are truthy", () => {
        const c = calc();
        const users = [
          { name: "Bob", age: 44 },
          { name: "Jane", age: 27 },
        ];
        expect(c.evaluate("all(xs, x, x > 3)", { xs: [1, 2, 3, 4] })).toBe(false);
        expect(c.evaluate("any(xs, x, x > 2)", { xs: 3 })).toBe(true);
        expect(c.evaluate("all({1,2,3,4}, x, x > 0)")).toBe(true);
        expect(c.evaluate("all({1,2,3,4}, x, x > 10)")).toBe(false);
        expect(c.evaluate("all(users, u, u.age > 33)", { users })).toBe(false);
        expect(c.evaluate("all(users, u, u.age < 50)", { users })).toBe(true);
      });
    });

    describe("map", () => {
      it("maps values", () => {
        const c = calc();
        const users = [
          { name: "Bob", age: 44 },
          { name: "Jane", age: 27 },
        ];
        expect(c.evaluate("map(xs, x, x * 2)", { xs: [1, 2, 3, 4] })).toEqual([2, 4, 6, 8]);
        expect(c.evaluate("map({1,2,3,4}, x, x * 2)")).toEqual([2, 4, 6, 8]);
        expect(c.evaluate("map(users, u, u.age)", { users })).toEqual([44, 27]);
        expect(c.evaluate("map(users, u, u.name)", { users })).toEqual(["Bob", "Jane"]);
        expect(c.evaluate("map(users, u, IF(u.age < 30, u, null))", { users })).toEqual([
          null,
          { name: "Jane", age: 27 },
        ]);
      });
    });

    describe("pluck", () => {
      it("plucks values from array of objects", () => {
        const c = calc();
        const users = [
          { name: "Bob", age: 44 },
          { name: "Jane", age: 27 },
        ];
        expect(c.evaluate("pluck(users, age)", { users })).toEqual([44, 27]);
        expect(c.evaluate("pluck(users, name)", { users })).toEqual(["Bob", "Jane"]);
      });
    });

    it("evaluates functions with stored variables", () => {
      const c = calc();
      c.store({
        multi_color: true,
        number_of_sheets: 5000,
        sheets_per_minute_black: 2000,
        sheets_per_minute_color: 1000,
      });
      expect(
        c.evaluate(
          "number_of_sheets / if(multi_color, sheets_per_minute_color, sheets_per_minute_black)",
        ),
      ).toBe(5);
    });

    describe("roundup", () => {
      it("works with one argument", () => {
        expect(calc().evaluate("roundup(1.234)")).toBe(2);
      });

      it("accepts second precision argument like in Office formula", () => {
        expect(calc().evaluate("roundup(1.234, 2)")).toBe(1.24);
      });
    });

    describe("rounddown", () => {
      it("works with one argument", () => {
        expect(calc().evaluate("rounddown(1.234)")).toBe(1);
      });

      it("accepts second precision argument like in Office formula", () => {
        expect(calc().evaluate("rounddown(1.234, 2)")).toBe(1.23);
      });
    });
  });

  describe("null values", () => {
    it("cannot be used as an IF predicate", () => {
      // ADR-0003.2: strict booleans — Ruby treated nil as false (→ 2).
      expect(() => calc().evaluate("IF(null, 1, 2)")).toThrow(TypeMismatchError);
      expect(() => calc().evaluate("IF(foo, 1, 2)", { foo: null })).toThrow(TypeMismatchError);
    });

    // Ruby: 'are carried across middle terms' uses solve! (issue 012).

    it("raises errors when used in arithmetic operations", () => {
      // Ruby raised Dentaku::ArgumentError via solve!; adapted to evaluate.
      expect(() => calc().evaluate("apples + 1", { apples: null })).toThrow(TypeMismatchError);
    });
  });

  describe("case statements", () => {
    const formula = `
      CASE fruit
      WHEN 'apple'
        THEN 1 * quantity
      WHEN 'banana'
        THEN 2 * quantity
      ELSE
        3 * quantity
      END
    `;

    it("handles complex then statements", () => {
      const c = calc();
      expect(c.evaluate(formula, { quantity: 3, fruit: "apple" })).toBe(3);
      expect(c.evaluate(formula, { quantity: 3, fruit: "banana" })).toBe(6);
    });

    it("evaluates case statement as part of a larger expression", () => {
      const c = calc();
      expect(c.evaluate(`2 + ${formula}`, { quantity: 3, fruit: "apple" })).toBe(5);
      expect(c.evaluate(`2 + ${formula}`, { quantity: 3, fruit: "banana" })).toBe(8);
      expect(c.evaluate(`2 + ${formula}`, { quantity: 3, fruit: "kiwi" })).toBe(11);
      expect(c.evaluate(`${formula} + 2`, { quantity: 3, fruit: "apple" })).toBe(5);
      expect(c.evaluate(`${formula} + 2`, { quantity: 3, fruit: "banana" })).toBe(8);
      expect(c.evaluate(`${formula} + 2`, { quantity: 3, fruit: "kiwi" })).toBe(11);
    });

    it("handles complex when statements", () => {
      const c = calc();
      const f = `
        CASE number
        WHEN (2 * 2)
          THEN 1
        WHEN (2 * 3)
          THEN 2
        END
      `;
      expect(c.evaluate(f, { number: 4 })).toBe(1);
      expect(c.evaluate(f, { number: 6 })).toBe(2);
    });

    it("returns null when no match and there is no default value", () => {
      // Spec'd deviation from Ruby (docs/issues/006-parser-evaluator-core.md):
      // Ruby raised "No block matched the switch value '2'"; here CASE with no
      // match and no ELSE yields null.
      const f = `
        CASE number
        WHEN 42
          THEN 1
        END
      `;
      expect(calc().evaluate(f, { number: 2 })).toBe(null);
    });

    it("handles a default else statement", () => {
      const c = calc();
      expect(c.evaluate(formula, { quantity: 1, fruit: "banana" })).toBe(2);
      expect(c.evaluate(formula, { quantity: 1, fruit: "orange" })).toBe(3);
    });

    it("handles nested case statements", () => {
      const f = `
        CASE fruit
        WHEN 'apple'
          THEN 1 * quantity
        WHEN 'banana'
          THEN
          CASE quantity
          WHEN 1 THEN 2
          WHEN 10 THEN
            CASE type
            WHEN 'organic' THEN 5
            END
          END
        END
      `;
      expect(calc().evaluate(f, { type: "organic", quantity: 10, fruit: "banana" })).toBe(5);
    });

    it("handles nested case statements with case-sensitivity", () => {
      // ADR-0003.1: identifiers are case-sensitive by default (Ruby needed
      // case_sensitive: true for this).
      const f = `
        CASE fruit
        WHEN 'apple'
          THEN 1 * quantity
        WHEN 'banana'
          THEN
          CASE QUANTITY
          WHEN 1 THEN 2
          WHEN 10 THEN
            CASE type
            WHEN 'organic' THEN 5
            END
          END
        END
      `;
      expect(
        calc().evaluate(f, { type: "organic", quantity: 1, QUANTITY: 10, fruit: "banana" }),
      ).toBe(5);
    });

    it("handles multiple nested case statements", () => {
      const f = `
        CASE fruit
        WHEN 'apple'
          THEN
          CASE quantity
          WHEN 2 THEN 3
          END
        WHEN 'banana'
          THEN
          CASE quantity
          WHEN 1 THEN 2
          END
        END
      `;
      expect(calc().evaluate(f, { quantity: 1, fruit: "banana" })).toBe(2);
      expect(calc().evaluate(f, { quantity: 2, fruit: "apple" })).toBe(3);
    });
  });

  describe("math support", () => {
    // Ruby iterates every Math method; the packs are covered exhaustively in
    // tests/functions-math.spec.ts — representative host-level cases here.
    it("includes Math functions", () => {
      const c = calc();
      expect(c.evaluate("SQRT(20)")).toBeCloseTo(Math.sqrt(20), 10);
      expect(c.evaluate("atan2(x, y)", { x: 1, y: 2 })).toBeCloseTo(Math.atan2(1, 2), 10);
      expect(() => c.evaluate("atan2(x)", { x: 1 })).toThrow(ParseError);
    });

    // Ruby: 'defines a properly named class to support AST marshaling' —
    // Ruby-only surface (no const_set class generation in TS).

    it("properly handles a math domain error", () => {
      expect(calc().tryEvaluate("asin(2)")).toBeUndefined();
      expect(() => calc().evaluate("asin(2)")).toThrow(MathDomainError);
    });
  });

  // Ruby: describe 'disable_cache' / 'clear_cache' / load_cache — the cache
  // surface is deliberately minimal (PLAN.md): the constructor accepts a Map
  // for bring-your-own caching; clearing = clearing your own Map. See
  // tests/ast-cache.spec.ts.

  describe("string functions", () => {
    it("concatenates strings", () => {
      expect(calc().evaluate("CONCAT(s1, s2, s3)", { s1: "ab", s2: "cd", s3: "ef" })).toBe(
        "abcdef",
      );
    });

    it("manipulates string arguments", () => {
      const c = calc();
      expect(c.evaluate("left('ABCD', 2)")).toBe("AB");
      expect(c.evaluate("right('ABCD', 2)")).toBe("CD");
      expect(c.evaluate("mid('ABCD', 2, 2)")).toBe("BC");
      expect(c.evaluate("len('ABCD')")).toBe(4);
      expect(c.evaluate("find('BC', 'ABCD')")).toBe(2);
      expect(c.evaluate("substitute('ABCD', 'BC', 'XY')")).toBe("AXYD");
      expect(c.evaluate("contains('BC', 'ABCD')")).toBe(true);
    });
  });

  describe("zero-arity functions", () => {
    it("can be used in formulas", () => {
      const c = calc();
      c.addFunction({ name: "two", returnType: "numeric", fn: () => new Decimal(2) });
      expect(c.evaluate("max(two(), 1)")).toBe(2);
      expect(c.evaluate("max(1, two())")).toBe(2);
    });
  });

  // Ruby: describe 'aliases' — i18n/function aliases are 1.x backlog
  // (PLAN.md "Out of scope"); no aliases option exists.

  describe("nestedData", () => {
    it("defaults to nested data enabled", () => {
      const c = calc();
      c.store({ a: { b: { c: 1 } } });
      expect(c.evaluate("a.b.c")).toBe(1);
    });

    it("allows opt out of nested data support", () => {
      // Ruby asserts via solve!('a.b.c') raising UnboundVariableError (issue
      // 012); the memory behavior is the point.
      const c = new Calculator({ nestedData: false });
      c.store({ a: { b: { c: 1 } } });
      expect(() => c.evaluate("a.b.c")).toThrow(UnboundVariableError);
      // The whole object is still stored under its own key.
      expect(c.evaluate("a")).toEqual({ b: { c: 1 } });
    });
  });

  // Ruby: describe 'identifier cache' — Ruby's enable_identifier_cache!
  // mutated caller-provided variable hashes; removed unconditionally
  // (PLAN.md "Removals": the identifier-cache mutation regret stays dead).

  describe("identifier case handling", () => {
    it("is case-sensitive by default", () => {
      // ADR-0003.1: Ruby downcased identifiers and memory keys by default.
      const c = calc();
      c.store({ Apples: 3 });
      expect(c.evaluate("Apples + 1")).toBe(4);
      expect(() => c.evaluate("apples + 1")).toThrow(UnboundVariableError);
    });

    it("restores Ruby behavior with caseInsensitiveIdentifiers", () => {
      const c = new Calculator({ caseInsensitiveIdentifiers: true });
      c.store({ Apples: 3 });
      expect(c.evaluate("APPLES + Pears", { PEARS: 10 })).toBe(13);
    });
  });

  describe("raw results", () => {
    it("returns internal types with {raw: true}", () => {
      const c = calc();
      const n = c.evaluate("0.1 + 0.2", undefined, { raw: true });
      expect(n).toBeInstanceOf(Decimal);
      expect((n as Decimal).toString()).toBe("0.3");
      const d = new Calculator({ dateLiterals: true }).evaluate("2020-01-01", undefined, {
        raw: true,
      });
      expect(d).toBeInstanceOf(CivilDateTime);
    });

    it("converts outward by default", () => {
      expect(calc().evaluate("0.1 + 0.2")).toBe(0.3);
    });
  });

  describe("module-level conveniences", () => {
    it("evaluates with a throwaway calculator", () => {
      expect(moduleEvaluate("7+3")).toBe(10);
      expect(moduleEvaluate("x * 2", { x: 21 })).toBe(42);
      expect(() => moduleEvaluate("a + b")).toThrow(UnboundVariableError);
      expect(moduleTryEvaluate("a + b")).toBeUndefined();
      expect(moduleTryEvaluate("1 + 1")).toBe(2);
    });

    it("shares no state with any Calculator instance", () => {
      const c = calc();
      c.addFunction({ name: "custom_fn", returnType: "numeric", fn: () => new Decimal(1) });
      c.store({ stored_var: 1 });
      // No global registry, no global memory (PLAN.md "Removals").
      expect(() => moduleEvaluate("CUSTOM_FN()")).toThrow(ParseError);
      expect(() => moduleEvaluate("stored_var")).toThrow(UnboundVariableError);
    });
  });
});
