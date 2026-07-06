// Ported from Ruby dentaku v3.5.7: spec/ast/{map,filter,all,any,pluck,reduce}_spec.rb,
// plus the dependency-reporting and shadowing tests required by
// docs/issues/009-functions-collection.md.
//
// Deviations from Ruby behavior are annotated with their ADR tightening:
//   ADR-0003.2 strict booleans — filter/all/any bodies must produce booleans
//   (TypeMismatchError otherwise), and Ruby's permissive swallow-to-nil for
//   all/any per-item errors is dropped (nil would fail the boolean check anyway).
//
// SUM and CONCAT are owned by issues 007/008; minimal test-local stand-ins are
// registered here so the Ruby formulas can be ported verbatim.
import { describe, expect, it } from "vitest";
import { IdentifierNode, Scope } from "../src/ast/index.js";
import type { Binding } from "../src/ast/node.js";
import { Decimal } from "../src/decimal.js";
import { ParseError, TypeMismatchError, UnboundVariableError } from "../src/errors.js";
import { collectionFunctions } from "../src/functions/collection.js";
import { FunctionSet } from "../src/functions/registry.js";
import type { FunctionDef } from "../src/functions/types.js";
import { parseFormula } from "../src/parser/parser.js";
import { type ExternalValue, toExternal, toInternal, type Value } from "../src/values.js";

// --- helpers -----------------------------------------------------------------

const testHelpers: FunctionDef[] = [
  {
    // Stand-in for issue 007's SUM: single array argument of Decimals.
    name: "sum",
    returnType: "numeric",
    minArgs: 1,
    maxArgs: 1,
    fn: (arg) =>
      (arg as Value[]).reduce<Decimal>((acc, v) => acc.plus(v as Decimal), new Decimal(0)),
  },
  {
    // Stand-in for issue 008's CONCAT: joins stringified args, null → "".
    name: "concat",
    returnType: "string",
    minArgs: 1,
    maxArgs: "variadic",
    fn: (...args) => args.map((a) => (a === null ? "" : String(a))).join(""),
  },
];

const registry = new FunctionSet([...collectionFunctions, ...testHelpers]);

function context(vars: Record<string, ExternalValue> = {}, strict = false): Scope {
  const bindings: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(vars)) {
    bindings[k] = toInternal(v);
  }
  return Scope.of(bindings, { strict });
}

function ast(formula: string) {
  return parseFormula(formula, { registry });
}

function evaluate(formula: string, vars: Record<string, ExternalValue> = {}): ExternalValue {
  return toExternal(ast(formula).value(context(vars)));
}

function evaluateStrict(formula: string, vars: Record<string, ExternalValue> = {}): ExternalValue {
  return toExternal(ast(formula).value(context(vars, true)));
}

function dependencies(formula: string): string[] {
  return ast(formula).dependencies();
}

// --- spec/ast/map_spec.rb ------------------------------------------------------

describe("MAP (spec/ast/map_spec.rb)", () => {
  it("operates on each value in an array", () => {
    expect(evaluate("SUM(MAP(vals, val, val + 1))", { vals: [1, 2, 3] })).toBe(9);
  });

  it("works with an empty array", () => {
    expect(evaluate("MAP(vals, val, val + 1)", { vals: [] })).toEqual([]);
  });

  it("works with a single value if needed for some reason", () => {
    expect(evaluate("MAP(vals, val, val + 1)", { vals: 1 })).toEqual([2]);
  });

  it("treats a null collection as empty (Ruby Array(nil))", () => {
    expect(evaluate("MAP(vals, val, val + 1)", { vals: null })).toEqual([]);
  });

  it("raises a parse error if a string is passed as identifier", () => {
    expect(() => ast('MAP({1, 2, 3}, "val", val + 1)')).toThrow(ParseError);
    expect(() => ast('MAP({1, 2, 3}, "val", val + 1)')).toThrow(
      "MAP() requires second argument to be an identifier",
    );
  });

  it("treats missing keys in objects as NULL in permissive mode", () => {
    expect(evaluate("MAP(items, item, item.value)", { items: [{ value: 1 }, {}] })).toEqual([
      1,
      null,
    ]);
  });

  it("raises an error if accessing a missing key in an object in strict mode", () => {
    expect(() =>
      evaluateStrict("MAP(items, item, item.value)", { items: [{ value: 1 }, {}] }),
    ).toThrow(UnboundVariableError);
  });

  it("binds the whole element alongside its dotted keys", () => {
    expect(evaluate("MAP(users, u, u)", { users: [{ age: 44 }] })).toEqual([{ age: 44 }]);
  });

  it("binds nested objects with intermediates (u.address.city)", () => {
    expect(
      evaluate("MAP(users, u, u.address.city)", {
        users: [{ address: { city: "Denver" } }, { address: { city: "Boise" } }],
      }),
    ).toEqual(["Denver", "Boise"]);
  });
});

// --- spec/ast/filter_spec.rb ---------------------------------------------------

describe("FILTER (spec/ast/filter_spec.rb)", () => {
  it("excludes unmatched values", () => {
    expect(evaluate("SUM(FILTER(vals, val, val > 1))", { vals: [1, 2, 3] })).toBe(5);
  });

  it("works with a single value if needed for some reason", () => {
    expect(evaluate("FILTER(vals, val, val > 1)", { vals: 1 })).toEqual([]);
    expect(evaluate("FILTER(vals, val, val > 1)", { vals: 2 })).toEqual([2]);
  });

  it("supports modulo bodies", () => {
    expect(evaluate("FILTER(vals, val, val % 2 == 0)", { vals: [1, 2, 3, 4] })).toEqual([2, 4]);
  });

  it("raises a parse error if a string is passed as identifier", () => {
    expect(() => ast('FILTER({1, 2, 3}, "val", val % 2 == 0)')).toThrow(ParseError);
    expect(() => ast('FILTER({1, 2, 3}, "val", val % 2 == 0)')).toThrow(
      "FILTER() requires second argument to be an identifier",
    );
  });

  // ADR-0003.2: filter bodies must produce booleans — Ruby selected by
  // truthiness (any non-nil/false body kept the element).
  it("rejects non-boolean filter bodies (ADR-0003.2)", () => {
    expect(() => evaluate("FILTER(vals, val, val + 1)", { vals: [1, 2] })).toThrow(
      TypeMismatchError,
    );
  });

  // ADR-0003.2: filter never swallows per-item errors, in Ruby or here; a
  // missing key propagates even in permissive mode (Ruby parity).
  it("propagates per-item errors in permissive mode (Ruby parity)", () => {
    expect(() => evaluate("FILTER(items, item, item.flag)", { items: [{}] })).toThrow(
      UnboundVariableError,
    );
  });
});

// --- spec/ast/all_spec.rb ------------------------------------------------------

describe("ALL (spec/ast/all_spec.rb)", () => {
  it("performs ALL operation", () => {
    expect(evaluate("ALL(vals, val, val > 1)", { vals: [1, 2, 3] })).toBe(false);
  });

  it("works with a single value if needed for some reason", () => {
    expect(evaluate("ALL(vals, val, val > 1)", { vals: 1 })).toBe(false);
    expect(evaluate("ALL(vals, val, val > 1)", { vals: 2 })).toBe(true);
  });

  it("returns true for an empty collection", () => {
    expect(evaluate("ALL(vals, val, val > 1)", { vals: [] })).toBe(true);
  });

  it("raises a parse error if a string is passed as identifier", () => {
    expect(() => ast('ALL({1, 2, 3}, "val", val % 2 == 0)')).toThrow(ParseError);
    expect(() => ast('ALL({1, 2, 3}, "val", val % 2 == 0)')).toThrow(
      "ALL() requires second argument to be an identifier",
    );
  });

  // ADR-0003.2: Ruby swallowed the missing-key error to a falsy nil in
  // permissive mode (result false); with strict booleans a null body would be
  // a TypeMismatchError anyway, so the per-item error propagates instead.
  it("propagates missing-key errors even in permissive mode (ADR-0003.2)", () => {
    expect(() =>
      evaluate("ALL(items, item, item.value)", { items: [{ value: true }, {}] }),
    ).toThrow(UnboundVariableError);
  });

  it("raises an error if accessing a missing key in an object in strict mode", () => {
    expect(() =>
      evaluateStrict("ALL(items, item, item.value)", { items: [{ value: true }, {}] }),
    ).toThrow(UnboundVariableError);
  });

  // ADR-0003.2: Ruby's truthiness accepted `item.value` returning 1; here
  // bodies must be boolean.
  it("rejects non-boolean bodies (ADR-0003.2)", () => {
    expect(() => evaluate("ALL(vals, val, val)", { vals: [1] })).toThrow(TypeMismatchError);
  });

  it("short-circuits on the first false body", () => {
    // The missing-key item is never reached: 1 > 1 is false first.
    expect(evaluate("ALL(items, item, item.value > 1)", { items: [{ value: 1 }, {}] })).toBe(false);
  });
});

// --- spec/ast/any_spec.rb ------------------------------------------------------

describe("ANY (spec/ast/any_spec.rb)", () => {
  it("performs ANY operation", () => {
    expect(evaluate("ANY(vals, val, val > 1)", { vals: [1, 2, 3] })).toBe(true);
  });

  it("works with a single value if needed for some reason", () => {
    expect(evaluate("ANY(vals, val, val > 1)", { vals: 1 })).toBe(false);
    expect(evaluate("ANY(vals, val, val > 1)", { vals: 2 })).toBe(true);
  });

  it("returns false for an empty collection", () => {
    expect(evaluate("ANY(vals, val, val > 1)", { vals: [] })).toBe(false);
  });

  it("raises a parse error if a string is passed as identifier", () => {
    expect(() => ast('ANY({1, 2, 3}, "val", val % 2 == 0)')).toThrow(ParseError);
    expect(() => ast('ANY({1, 2, 3}, "val", val % 2 == 0)')).toThrow(
      "ANY() requires second argument to be an identifier",
    );
  });

  // ADR-0003.2: Ruby swallowed the first item's missing-key error to nil and
  // returned truthy from the second; strict booleans drop the swallow, so the
  // per-item error propagates.
  it("propagates missing-key errors even in permissive mode (ADR-0003.2)", () => {
    expect(() =>
      evaluate("ANY(items, item, item.value)", { items: [{}, { value: true }] }),
    ).toThrow(UnboundVariableError);
  });

  it("raises an error if accessing a missing key in an object in strict mode", () => {
    expect(() =>
      evaluateStrict("ANY(items, item, item.value)", { items: [{}, { value: true }] }),
    ).toThrow(UnboundVariableError);
  });

  it("short-circuits on the first true body", () => {
    // The missing-key item is never reached: 2 > 1 is true first.
    expect(evaluate("ANY(items, item, item.value > 1)", { items: [{ value: 2 }, {}] })).toBe(true);
  });
});

// --- spec/ast/pluck_spec.rb ----------------------------------------------------

describe("PLUCK (spec/ast/pluck_spec.rb)", () => {
  const users = [
    { name: "Bob", age: 44 },
    { name: "Jane", age: 27 },
  ];

  it("operates on each value in an array", () => {
    expect(evaluate("PLUCK(users, age)", { users })).toEqual([44, 27]);
  });

  it("allows specifying a default for missing values", () => {
    expect(
      evaluate("PLUCK(users, age, -1)", { users: [{ name: "Bob" }, { name: "Jane", age: 27 }] }),
    ).toEqual([-1, 27]);
  });

  it("returns null if pluck key is missing from an object", () => {
    expect(
      evaluate("PLUCK(users, age)", { users: [{ name: "Bob" }, { name: "Jane", age: 27 }] }),
    ).toEqual([null, 27]);
  });

  it("works with an empty array", () => {
    expect(evaluate("PLUCK(users, age)", { users: [] })).toEqual([]);
  });

  it("raises a parse error if a string is passed as identifier", () => {
    expect(() => ast('PLUCK(users, "age")')).toThrow(ParseError);
    expect(() => ast('PLUCK(users, "age")')).toThrow(
      "PLUCK() requires second argument to be an identifier",
    );
  });

  // Error-taxonomy mapping (PLAN.md): Ruby raises Dentaku::ArgumentError
  // (:incompatible_type); the incompatible-type family lands on
  // TypeMismatchError here. Same message, same parse/eval phase.
  it("raises a type error if a non array of objects is passed as collection", () => {
    expect(() => evaluate("PLUCK({1, 2, 3}, age)")).toThrow(TypeMismatchError);
    expect(() => evaluate("PLUCK({1, 2, 3}, age)")).toThrow(
      "PLUCK() requires first argument to be an array of hashes",
    );
  });

  it("distinguishes explicit null values from missing keys", () => {
    expect(evaluate("PLUCK(users, age, -1)", { users: [{ age: null }, { age: 27 }] })).toEqual([
      null,
      27,
    ]);
  });
});

// --- spec/ast/reduce_spec.rb ---------------------------------------------------

describe("REDUCE (spec/ast/reduce_spec.rb)", () => {
  it("performs REDUCE operation with initial value", () => {
    expect(
      evaluate('REDUCE(vals, memo, val, CONCAT(memo, val), "hello")', { vals: ["wo", "rl", "d"] }),
    ).toBe("helloworld");
  });

  it("performs REDUCE operation without initial value", () => {
    // The memo starts at null (Ruby reduce(nil)), not at the first element.
    expect(
      evaluate("REDUCE(vals, memo, val, CONCAT(memo, val))", { vals: ["wo", "rl", "d"] }),
    ).toBe("world");
  });

  it("returns the initial value (default null) for an empty collection", () => {
    expect(evaluate("REDUCE(vals, memo, val, CONCAT(memo, val), 42)", { vals: [] })).toBe(42);
    expect(evaluate("REDUCE(vals, memo, val, CONCAT(memo, val))", { vals: [] })).toBeNull();
  });

  it("raises a parse error if a string is passed as identifier", () => {
    expect(() => ast('REDUCE({1, 2, 3}, memo, "val", memo + val)')).toThrow(ParseError);
    expect(() => ast('REDUCE({1, 2, 3}, memo, "val", memo + val)')).toThrow(
      "REDUCE() requires third argument to be an identifier",
    );
    expect(() => ast('REDUCE({1, 2, 3}, "memo", val, memo + val)')).toThrow(ParseError);
    expect(() => ast('REDUCE({1, 2, 3}, "memo", val, memo + val)')).toThrow(
      "REDUCE() requires second argument to be an identifier",
    );
  });

  it("binds object items with dotted keys", () => {
    expect(
      evaluate("REDUCE(rows, memo, row, memo + row.n, 0)", { rows: [{ n: 1 }, { n: 2 }] }),
    ).toBe(3);
  });
});

// --- dependency reporting (issue 009) -------------------------------------------

describe("collection function dependencies", () => {
  it("subtracts the bound identifier from the body's deps", () => {
    expect(dependencies("map(xs, x, x * rate)")).toEqual(["xs", "rate"]);
  });

  it("subtracts the bound identifier's dotted prefixes", () => {
    expect(dependencies("map(users, u, u.age + bonus)")).toEqual(["users", "bonus"]);
  });

  it("keeps a collection dep that collides with the bound identifier", () => {
    expect(dependencies("map(x, x, x + 1)")).toEqual(["x"]);
  });

  it("applies to filter/all/any alike", () => {
    expect(dependencies("filter(xs, x, x > cutoff)")).toEqual(["xs", "cutoff"]);
    expect(dependencies("all(xs, x, x > cutoff)")).toEqual(["xs", "cutoff"]);
    expect(dependencies("any(xs, x, x > cutoff)")).toEqual(["xs", "cutoff"]);
  });

  it("does not report the pluck key as a dependency", () => {
    expect(dependencies("pluck(users, age)")).toEqual(["users"]);
    expect(dependencies("pluck(users, age, fallback)")).toEqual(["users", "fallback"]);
  });

  it("subtracts both reduce identifiers and includes initial-value deps", () => {
    expect(dependencies("reduce(xs, memo, x, memo + x + rate, init)")).toEqual([
      "xs",
      "rate",
      "init",
    ]);
    expect(dependencies("reduce(xs, memo, x, memo + x)")).toEqual(["xs"]);
  });

  it("resolves bound identifiers through an EvalContext", () => {
    const node = ast("map(xs, x, x * rate)");
    expect(node.dependencies(context({ xs: [1], rate: 2 }))).toEqual([]);
    expect(node.dependencies(context({ xs: [1] }))).toEqual(["rate"]);
  });
});

// --- scoping (issue 009) ---------------------------------------------------------

describe("collection function scoping", () => {
  it("shadows an outer binding inside the body and restores it after", () => {
    const ctx = context({ x: 100, xs: [1, 2, 3] });
    expect(toExternal(ast("map(xs, x, x * 2)").value(ctx))).toEqual([2, 4, 6]);
    // The outer binding is untouched: the element binding lived in a child scope.
    expect(toExternal(new IdentifierNode("x").value(ctx))).toBe(100);
    expect(toExternal(ast("map(xs, x, x) ").value(ctx))).toEqual([1, 2, 3]);
  });

  it("lets the body reach outer bindings that are not shadowed", () => {
    expect(evaluate("map(xs, x, x * rate)", { xs: [1, 2], rate: 10 })).toEqual([10, 20]);
  });

  it("evaluates nested enum functions with independent bindings", () => {
    expect(
      evaluate("map(rows, row, SUM(map(row, cell, cell + 1)))", {
        rows: [
          [1, 2],
          [3, 4],
        ],
      }),
    ).toEqual([5, 9]);
  });
});
