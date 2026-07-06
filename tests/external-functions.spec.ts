// Ported from Ruby dentaku v3.5.7 spec/external_function_spec.rb (issue 011).
//
// Ruby's (name, type, lambda, callback) tuples become FunctionDef descriptors;
// the parse-time `callback` hook maps to FunctionDef.checkArgs. Ruby-only
// surface is skipped with citing comments: the class-per-function const_set
// machinery (`Dentaku::AST::Function::Callback_lambda`), AST marshaling, and
// the class-level global registry (Calculator.add_function) — PLAN.md
// "Removals": no global function registry of any kind.
import { describe, expect, it } from "vitest";
import {
  Calculator,
  Decimal,
  type FunctionDef,
  ParseError,
  TypeMismatchError,
  type Value,
} from "../src/index.js";

const dec = (v: Value): Decimal => v as Decimal;

function customCalculator(): Calculator {
  const c = new Calculator();
  c.addFunction({
    name: "now",
    returnType: "string",
    fn: () => new Date().toISOString(),
  });
  const fns: FunctionDef[] = [
    // Shadows the built-in `pow` from the math pack — instance-level
    // registration may replace built-ins (Ruby parity); only re-registering
    // the same name on the same calculator is an error.
    {
      name: "pow",
      returnType: "numeric",
      minArgs: 2,
      maxArgs: 2,
      fn: (mantissa, exponent) => dec(mantissa).pow(dec(exponent)),
    },
    {
      name: "biggest",
      returnType: "numeric",
      minArgs: 1,
      maxArgs: "variadic",
      fn: (...args) => args.reduce((max, v) => (dec(v).gt(dec(max)) ? v : max)),
    },
    {
      name: "smallest",
      returnType: "numeric",
      minArgs: 1,
      maxArgs: "variadic",
      fn: (...args) => args.reduce((min, v) => (dec(v).lt(dec(min)) ? v : min)),
    },
    {
      name: "optional",
      returnType: "numeric",
      minArgs: 2,
      maxArgs: 3,
      fn: (...args) => {
        const [x, y, z] = args as [Value, Value, Value | undefined];
        return dec(x)
          .plus(dec(y))
          .plus(z === undefined ? 0 : dec(z));
      },
    },
  ];
  return c.addFunctions(fns);
}

describe("external functions", () => {
  it("includes NOW", () => {
    const now = customCalculator().evaluate("NOW()");
    expect(now).not.toBeNull();
    expect(now).not.toBe("");
  });

  it("includes POW", () => {
    const c = customCalculator();
    expect(c.evaluate("POW(2,3)")).toBe(8);
    expect(c.evaluate("POW(3,2)")).toBe(9);
    expect(c.evaluate("POW(mantissa,exponent)", { mantissa: 2, exponent: 4 })).toBe(16);
  });

  it("includes BIGGEST", () => {
    expect(customCalculator().evaluate("BIGGEST(8,6,7,5,3,0,9)")).toBe(9);
  });

  it("includes SMALLEST", () => {
    expect(customCalculator().evaluate("SMALLEST(8,6,7,5,3,0,9)")).toBe(0);
  });

  it("includes OPTIONAL", () => {
    const c = customCalculator();
    expect(c.evaluate("OPTIONAL(1,2)")).toBe(3);
    expect(c.evaluate("OPTIONAL(1,2,3)")).toBe(6);
    expect(() => c.dependencies("OPTIONAL()")).toThrow(ParseError);
    expect(() => c.dependencies("OPTIONAL(1,2,3,4)")).toThrow(ParseError);
  });

  it("supports array parameters", () => {
    const c = new Calculator();
    c.addFunction({
      name: "includes",
      returnType: "logical",
      minArgs: 2,
      maxArgs: 2,
      fn: (haystack, needle) => (haystack as Value[]).some((v) => dec(v).eq(dec(needle))),
    });
    expect(c.evaluate("INCLUDES(list, 2)", { list: [1, 2, 3] })).toBe(true);
  });

  describe("with parse-time argument checks (Ruby callbacks)", () => {
    function callbackCalculator(): Calculator {
      const c = new Calculator();
      c.addFunction({
        name: "reverse",
        returnType: "string",
        minArgs: 1,
        maxArgs: 1,
        fn: (a) => (a as string).split("").reverse().join(""),
      });
      c.addFunctions([
        {
          name: "biggest_callback",
          returnType: "numeric",
          minArgs: 1,
          maxArgs: "variadic",
          fn: (...args) => args.reduce((max, v) => (dec(v).gt(dec(max)) ? v : max)),
          // Ruby's callback raised Dentaku::ArgumentError for non-numeric
          // argument nodes at parse time; checkArgs is the parse-time hook.
          checkArgs: (argNodes) => {
            for (const node of argNodes) {
              if (node.type !== "numeric" && node.type !== null) {
                throw new TypeMismatchError("BIGGEST_CALLBACK() requires numeric arguments");
              }
            }
          },
        },
        {
          name: "pythagoras",
          returnType: "numeric",
          minArgs: 2,
          maxArgs: 2,
          fn: (l1, l2) => new Decimal(Math.sqrt(dec(l1).toNumber() ** 2 + dec(l2).toNumber() ** 2)),
        },
      ]);
      return c;
    }

    it("includes BIGGEST_CALLBACK", () => {
      const c = callbackCalculator();
      expect(c.evaluate("BIGGEST_CALLBACK(1, 2, 5, 4)")).toBe(5);
      expect(() => c.dependencies('BIGGEST_CALLBACK(1, 3, 6, "hi", 10)')).toThrow(
        TypeMismatchError,
      );
    });

    it("includes REVERSE", () => {
      const c = callbackCalculator();
      expect(c.evaluate("REVERSE('Dentaku')")).toBe("ukatneD");
      // Ruby raised NoMethodError (a bug, not a Dentaku error) — the TS analog
      // (TypeError) propagates even through tryEvaluate (ADR-0002).
      expect(() => c.tryEvaluate("REVERSE(22)")).toThrow(TypeError);
    });

    it("includes PYTHAGORAS", () => {
      const c = callbackCalculator();
      expect(c.evaluate("PYTHAGORAS(8, 7)")).toBeCloseTo(10.63014581273465, 10);
      expect(c.evaluate("PYTHAGORAS(3, 4)")).toBe(5);
    });

    // Ruby: 'exposes the `callback` method of a function' / 'does not add a
    // `callback` method to built-in functions' / 'defaults `callback` to nil'
    // — Ruby-only class-generation surface (const_set per function); the
    // FunctionDef descriptor carries checkArgs directly.
  });

  it("allows registering 'bang' functions", () => {
    const c = new Calculator();
    c.addFunction({ name: "hey!", returnType: "string", fn: () => "hey!" });
    expect(c.evaluate("hey!()")).toBe("hey!");
  });

  // Ruby: 'defines ... a properly named class ... to support AST marshaling'
  // — Ruby-only (Marshal + const_set); descriptors need no class generation.

  it("does not store functions across all calculators", () => {
    const calculator1 = new Calculator();
    calculator1.addFunction({
      name: "my_function",
      returnType: "numeric",
      minArgs: 1,
      maxArgs: 1,
      fn: (x) => dec(x).times(2).plus(1),
    });

    const calculator2 = new Calculator();
    calculator2.addFunction({
      name: "my_function",
      returnType: "numeric",
      minArgs: 1,
      maxArgs: 1,
      fn: (x) => dec(x).times(4).plus(3),
    });

    expect(calculator1.evaluate("1 + my_function(2)")).toBe(1 + 2 * 2 + 1);
    expect(calculator2.evaluate("1 + my_function(2)")).toBe(1 + 4 * 2 + 3);
    expect(() => new Calculator().evaluate("1 + my_function(2)")).toThrow(ParseError);
  });

  // Ruby: 'Dentaku::Calculator.add_function' / '.add_functions' add to a
  // global/default registry — removed unconditionally (PLAN.md "Removals":
  // no global function registry; all state is per-Calculator).

  describe("registration rules", () => {
    it("rejects rawFn special forms in the public path", () => {
      const c = new Calculator();
      expect(() =>
        c.addFunction({
          name: "sneaky",
          returnType: "any",
          rawFn: () => null,
        }),
      ).toThrow(TypeError);
    });

    it("rejects defs without fn", () => {
      expect(() => new Calculator().addFunction({ name: "empty", returnType: "any" })).toThrow(
        TypeError,
      );
    });

    it("rejects duplicate instance-level registration", () => {
      const c = new Calculator();
      c.addFunction({ name: "once", returnType: "numeric", fn: () => new Decimal(1) });
      expect(() =>
        c.addFunction({ name: "ONCE", returnType: "numeric", fn: () => new Decimal(2) }),
      ).toThrow(/already registered/);
    });

    it("allows shadowing built-ins (Ruby parity)", () => {
      const c = new Calculator();
      c.addFunction({
        name: "round",
        returnType: "numeric",
        minArgs: 1,
        maxArgs: 2,
        fn: () => new Decimal(42),
      });
      expect(c.evaluate("ROUND(1.5)")).toBe(42);
      // Other calculators keep the built-in.
      expect(new Calculator().evaluate("ROUND(1.5)")).toBe(2);
    });
  });

  describe("constructor functions option", () => {
    it("merges a FunctionSet over the default set", async () => {
      const { FunctionSet, defaultFunctionSet } = await import("../src/index.js");
      const custom = new FunctionSet([
        { name: "seven", returnType: "numeric", fn: () => new Decimal(7) },
        // Shadows the built-in abs.
        { name: "abs", returnType: "numeric", minArgs: 1, maxArgs: 1, fn: () => new Decimal(-1) },
      ]);
      const c = new Calculator({ functions: custom });
      expect(c.evaluate("SEVEN() + 1")).toBe(8);
      expect(c.evaluate("ABS(5)")).toBe(-1);
      // The shared default set is untouched.
      expect(defaultFunctionSet.has("seven")).toBe(false);
      expect(new Calculator().evaluate("ABS(-5)")).toBe(5);
    });
  });
});
