// Ported from Ruby dentaku v3.5.7 spec/bulk_expression_solver_spec.rb and
// spec/dependency_resolver_spec.rb (issue 012).
//
// API mapping (successor API shape per PLAN.md "Additions" / "Host API" —
// these are API-shape changes, not ADR tightenings):
//   Ruby `BulkExpressionSolver#solve!`  → `calc.solve` (throws first error)
//   Ruby `BulkExpressionSolver#solve`   → `calc.trySolve` ({ values, errors });
//     Ruby's `:undefined` placeholders map to `errors` entries, and the
//     block-form error handlers map to the returned error objects themselves.
//   Ruby `ex.recipient_variable`        → `error.key`
//   Ruby `TSort::Cyclic`                → `CycleError` (with cycle membership;
//     only cycle members and their downstream dependents fail — independent
//     keys still solve, where Ruby abandoned the whole batch).
// Batch values are formula strings (or pre-parsed ASTs); Ruby additionally
// accepted integers and arrays of expressions — the array-of-formulas overload
// is removed in the successor (PLAN.md "Removals"), so those specs are
// adapted to string formulas below, annotated at each site.
import { describe, expect, it } from "vitest";
import {
  Calculator,
  CycleError,
  Decimal,
  type DentakuError,
  ParseError,
  TypeMismatchError,
  UnboundVariableError,
  ZeroDivisionError,
} from "../src/index.js";
import { sortDependencies } from "../src/solver/dependency-graph.js";

const calc = () => new Calculator();

describe("solve (Ruby BulkExpressionSolver#solve!)", () => {
  it("evaluates properly with variables, even if some in memory", () => {
    const expressions = {
      weekly_fruit_budget: "weekly_apple_budget + pear * 4",
      weekly_apple_budget: "apples * 7",
      pear: "1",
    };
    expect(calc().store({ apples: 3 }).solve(expressions)).toEqual({
      pear: 1,
      weekly_apple_budget: 21,
      weekly_fruit_budget: 25,
    });
  });

  it("lets you know if a variable is unbound", () => {
    expect(() => calc().solve({ more_apples: "apples + 1" })).toThrow(UnboundVariableError);
  });

  it("properly handles access on an unbound variable", () => {
    expect(() => calc().solve({ more_apples: "apples[0]" })).toThrow(UnboundVariableError);
  });

  it("lets you know if the result is a div/0 error when dividing", () => {
    expect(() => calc().solve({ more_apples: "1/0" })).toThrow(ZeroDivisionError);
  });

  it("lets you know if the result is a div/0 error when taking modulo", () => {
    expect(() => calc().solve({ more_apples: "1%0" })).toThrow(ZeroDivisionError);
  });

  it("does not require keys to be parseable", () => {
    const expressions = { "the value of x, incremented": "x + 1" };
    expect(calc().store("x", 3).solve(expressions)).toEqual({
      "the value of x, incremented": 4,
    });
  });

  it("allows self-referential formulas", () => {
    expect(calc().store({ x: 1 }).solve({ x: "x + 1" })).toEqual({ x: 2 });

    // x = 6 by the time y is calculated
    expect(calc().store({ x: 5, y: 3 }).solve({ x: "y + 3", y: "x * 2" })).toEqual({
      x: 6,
      y: 12,
    });
  });

  it("does not execute functions unnecessarily", () => {
    let calls = 0;
    const c = calc().addFunction({
      name: "external",
      returnType: "numeric",
      fn: () => {
        calls += 1;
        return new Decimal(calls);
      },
    });
    c.solve({ test: "EXTERNAL()" });
    expect(calls).toBe(1);
  });

  it("evaluates expressions in nested hashes and expands the results", () => {
    // Adapted: Ruby's `discounts` was an in-batch *array* of expressions;
    // array-of-formulas batch values are removed (PLAN.md "Removals"), so the
    // discounts are stored values here and the nested-hash behavior is intact.
    const c = calc().store({
      fruit_quantities: { apple: 5, pear: 9 },
      fruit_prices: { apple: 1.66, pear: 2.5 },
      discounts: [0.8, 0.6],
    });
    const expressions = {
      weekly_budget: {
        fruit: "weekly_budget.apples + weekly_budget.pears",
        apples: "fruit_quantities.apple * discounted_fruit_prices.apple",
        pears: "fruit_quantities.pear * discounted_fruit_prices.pear",
      },
      discounted_fruit_prices: {
        apple: "round(fruit_prices.apple * discounts[0], 2)",
        pear: "round(fruit_prices.pear * discounts[1], 2)",
      },
    };
    expect(c.solve(expressions)).toEqual({
      weekly_budget: { fruit: 20.15, apples: 6.65, pears: 13.5 },
      discounted_fruit_prices: { apple: 1.33, pear: 1.5 },
    });
  });
});

describe("trySolve (Ruby BulkExpressionSolver#solve)", () => {
  it("resolves capitalized keys when they are declared out of order", () => {
    // Adapted: Ruby's `THIRD: 2` (integer batch value) becomes the formula
    // string "2" — batch values are formulas (PLAN.md "Host API").
    const expressions = { FIRST: "SECOND * 2", SECOND: "THIRD * 2", THIRD: "2" };
    expect(calc().trySolve(expressions)).toEqual({
      values: { FIRST: 8, SECOND: 4, THIRD: 2 },
      errors: {},
    });
  });

  it("reports unbound variables in errors (Ruby returned :undefined)", () => {
    const { values, errors } = calc().trySolve({ more_apples: "apples + 1" });
    expect(values).toEqual({});
    expect(errors.more_apples).toBeInstanceOf(UnboundVariableError);
    expect((errors.more_apples as UnboundVariableError).unboundVariables).toEqual(["apples"]);
  });

  it("reports div/0 in errors (Ruby block-handler custom values)", () => {
    const { errors } = calc().trySolve({ more_apples: "1/0" });
    expect(errors.more_apples).toBeInstanceOf(ZeroDivisionError);
  });

  it("allows passing in ast as expression", () => {
    const c = calc();
    const { errors } = c.trySolve({ more_apples: c.ast("1/0") });
    expect(errors.more_apples).toBeInstanceOf(ZeroDivisionError);
  });

  it("stores the recipient variable on the exception when there is a div/0 error", () => {
    const { errors } = calc().trySolve({ more_apples: "1/0" });
    expect(errors.more_apples?.key).toBe("more_apples");
  });

  it("stores the recipient variable on the exception when there is an unbound variable", () => {
    const { errors } = calc().trySolve({ more_apples: "apples + 1" });
    expect(errors.more_apples?.key).toBe("more_apples");
  });

  it("stores the recipient variable on the exception for a type error on a dependency", () => {
    // Ruby raised Dentaku::ArgumentError for `1 + nil`; here `null` in
    // arithmetic is a TypeMismatchError (ADR-0003.3: no coercion in
    // arithmetic) — the recipient key is what this spec checks.
    const { errors } = calc().trySolve({ apples: "NULL", more_apples: "1 + apples" });
    expect(errors.more_apples).toBeInstanceOf(TypeMismatchError);
    expect(errors.more_apples?.key).toBe("more_apples");
  });

  it("safely handles argument errors", () => {
    const c = calc().store({ m: 3 });
    const { values, errors } = c.trySolve({ i: "a / 5 + d", a: "m * 12", d: "a + b" });
    expect(values).toEqual({ a: 36 });
    // d fails on the truly-unbound b; i then fails on its failed dependency d
    // (the failed upstream key is simply missing, Ruby-parity behavior).
    expect(errors.d).toBeInstanceOf(UnboundVariableError);
    expect((errors.d as UnboundVariableError).unboundVariables).toEqual(["b"]);
    expect(errors.i).toBeInstanceOf(UnboundVariableError);
    expect((errors.i as UnboundVariableError).unboundVariables).toEqual(["d"]);
  });

  it("supports nested hashes of expressions using dot notation", () => {
    // Adapted: Ruby's `d: [3, 4, 5]` / `e: [...]` array batch values become
    // plain formulas (PLAN.md "Removals": array-of-formulas overload).
    const expressions = {
      a: "25",
      b: { c: "a / 5", d: "4" },
      e: "b.c + b.d",
      f: "e + 1",
    };
    const { values, errors } = calc().trySolve(expressions);
    expect(errors).toEqual({});
    expect(values.f).toBe(10);
  });

  it("uses stored values for expressions when they are known", () => {
    const c = calc().store({ Force: 50, Mass: 25 });
    const expressions = {
      Force: "Mass * Acceleration",
      Mass: "Force / Acceleration",
      Acceleration: "Force / Mass",
    };
    expect(c.trySolve(expressions)).toEqual({
      values: { Force: 50, Mass: 25, Acceleration: 2 },
      errors: {},
    });
  });

  it("solves all expressions for which context exists, reporting errors for the rest", () => {
    // Adapted from Ruby's array-expression spec ('key' => [expr, expr]):
    // array batch values are removed (PLAN.md "Removals"), so the two array
    // elements become two named keys with the same solvable/unsolvable split.
    const c = calc().store({ first: 1, equation: 3 });
    const { values, errors } = c.trySolve({
      solvable: "first * equation",
      unsolvable: "second * equation",
    });
    expect(values).toEqual({ solvable: 3 });
    expect(errors.unsolvable).toBeInstanceOf(UnboundVariableError);
    expect(() =>
      c.solve({ solvable: "first * equation", unsolvable: "second * equation" }),
    ).toThrow(UnboundVariableError);
  });

  it("reports errors from both eager evaluation and strict conditionals", () => {
    const c = calc().store({ val: null });
    const { values, errors } = c.trySolve({
      a: "IF(5 / 0 > 0, 100, 1000)",
      b: "IF(val = 0, 0, IF(val > 0, 0, 0))",
    });
    expect(values).toEqual({});
    expect(errors.a).toBeInstanceOf(ZeroDivisionError);
    // Ruby raised Dentaku::ArgumentError comparing nil; comparing null is a
    // TypeMismatchError here (ADR-0003.3: no coercion in comparators).
    expect(errors.b).toBeInstanceOf(TypeMismatchError);
  });
});

describe("dependency graph (Ruby DependencyResolver)", () => {
  it("sorts expressions in dependency order", () => {
    const graph = sortDependencies(
      new Map([
        ["first", ["second"]],
        ["second", ["third"]],
        ["third", []],
      ]),
    );
    expect(graph.order).toEqual(["third", "second", "first"]);
    expect(graph.cycles.size).toBe(0);
    expect(graph.blocked.size).toBe(0);
  });

  it("handles case differences via the calculator's identifier normalization", () => {
    // Ruby's DependencyResolver always downcased; here case-folding is the
    // calculator's caseInsensitiveIdentifiers option (ADR-0003.1: identifiers
    // are case-sensitive by default), and result keys keep their input casing.
    const c = new Calculator({ caseInsensitiveIdentifiers: true });
    const expressions = { FIRST: "second * 2", SeCoNd: "third * 2", THIRD: "2" };
    expect(c.solve(expressions)).toEqual({ FIRST: 8, SeCoNd: 4, THIRD: 2 });
  });

  it("is case-sensitive by default (ADR-0003.1)", () => {
    const { values, errors } = calc().trySolve({ FIRST: "SECOND * 2", second: "2" });
    expect(values).toEqual({ second: 2 });
    expect(errors.FIRST).toBeInstanceOf(UnboundVariableError);
    expect((errors.FIRST as UnboundVariableError).unboundVariables).toEqual(["SECOND"]);
  });

  it("reports cycle membership", () => {
    const graph = sortDependencies(
      new Map([
        ["a", ["b"]],
        ["b", ["a"]],
        ["c", []],
      ]),
    );
    expect(graph.cycles.get("a")).toEqual(["a", "b"]);
    expect(graph.cycles.get("b")).toEqual(["a", "b"]);
    expect(graph.cycles.has("c")).toBe(false);
  });

  it("marks keys downstream of a cycle as blocked, not as cycle members", () => {
    const graph = sortDependencies(
      new Map([
        ["a", ["b"]],
        ["b", ["a"]],
        ["c", ["a"]],
        ["d", ["c"]],
        ["e", []],
      ]),
    );
    expect(graph.cycles.has("c")).toBe(false);
    expect(graph.blocked.get("c")).toEqual(["a", "b"]);
    expect(graph.blocked.get("d")).toEqual(["a", "b"]);
    expect(graph.blocked.has("e")).toBe(false);
  });

  it("treats a self-referential key with no stored value as a cycle", () => {
    const graph = sortDependencies(new Map([["a", ["a"]]]));
    expect(graph.cycles.get("a")).toEqual(["a"]);
  });
});

describe("cycles (successor behavior, PLAN.md 'Additions')", () => {
  it("solve throws CycleError listing the members", () => {
    const err = captureError(() => calc().solve({ a: "b + 1", b: "a + 1" }));
    expect(err).toBeInstanceOf(CycleError);
    expect([...(err as CycleError).cycle].sort()).toEqual(["a", "b"]);
    expect(err.key).toBe("a");
  });

  it("trySolve fails only cycle members; independent keys still solve", () => {
    // Required by docs/issues/012-solver.md: partial-cycle batch. Ruby
    // abandoned the whole batch on TSort::Cyclic.
    const { values, errors } = calc().trySolve({ a: "b + 1", b: "a + 1", c: "2 + 2" });
    expect(values).toEqual({ c: 4 });
    expect(errors.a).toBeInstanceOf(CycleError);
    expect(errors.b).toBeInstanceOf(CycleError);
    expect(errors.a?.key).toBe("a");
    expect(errors.b?.key).toBe("b");
    expect([...(errors.a as CycleError).cycle].sort()).toEqual(["a", "b"]);
  });

  it("keys downstream of a cycle fail with CycleError naming the upstream cycle", () => {
    const { values, errors } = calc().trySolve({
      a: "b + 1",
      b: "a + 1",
      d: "a * 2",
      e: "d + independent",
      independent: "1",
    });
    expect(values).toEqual({ independent: 1 });
    expect(errors.d).toBeInstanceOf(CycleError);
    expect([...(errors.d as CycleError).cycle].sort()).toEqual(["a", "b"]);
    expect(errors.e).toBeInstanceOf(CycleError);
    expect(errors.e?.key).toBe("e");
  });

  it("a self-referential key with no stored value is a one-member cycle", () => {
    // Successor cycle detection covers self-loops (PLAN.md "Additions": cycle
    // membership); Ruby's TSort missed them and raised UnboundVariableError.
    const { errors } = calc().trySolve({ x: "x + 1" });
    expect(errors.x).toBeInstanceOf(CycleError);
    expect((errors.x as CycleError).cycle).toEqual(["x"]);
  });

  it("a stored value breaks the self-cycle (Ruby parity)", () => {
    expect(calc().store({ x: 1 }).trySolve({ x: "x + 1" })).toEqual({
      values: { x: 2 },
      errors: {},
    });
  });
});

describe("per-key errors (successor API, PLAN.md 'Additions')", () => {
  it("preserves the causing error class and key per formula", () => {
    // Required by docs/issues/012-solver.md: ZeroDivisionError on the right key.
    const { values, errors } = calc().trySolve({
      fine: "2 * 3",
      broken: "1 / 0",
      alsoFine: "10 - 1",
    });
    expect(values).toEqual({ fine: 6, alsoFine: 9 });
    expect(Object.keys(errors)).toEqual(["broken"]);
    expect(errors.broken).toBeInstanceOf(ZeroDivisionError);
    expect(errors.broken?.key).toBe("broken");
    expect(errors.broken?.formula).toBe("1 / 0");
  });

  it("reports parse failures per key without abandoning the batch", () => {
    const { values, errors } = calc().trySolve({ bad: "1 +", good: "2" });
    expect(values).toEqual({ good: 2 });
    expect(errors.bad).toBeInstanceOf(ParseError);
    expect(errors.bad?.key).toBe("bad");
  });

  it("puts every input key in exactly one of values/errors", () => {
    const { values, errors } = calc().trySolve({
      a: "1",
      b: "a + missing",
      c: { d: "a * 2", e: "1/0" },
    });
    const valueKeys = ["a", ...Object.keys(values.c ?? {}).map((k) => `c.${k}`)];
    expect(values).toEqual({ a: 1, c: { d: 2 } });
    expect(Object.keys(errors).sort()).toEqual(["b", "c.e"]);
    expect(valueKeys.sort()).toEqual(["a", "c.d"]);
  });
});

describe("solve error ordering", () => {
  it("throws the first error in dependency order, not input order", () => {
    // b comes first in the batch but depends on a, whose failure is the
    // first error in evaluation order.
    const err = captureError(() => calc().solve({ b: "a + 1", a: "1 / 0" }));
    expect(err).toBeInstanceOf(ZeroDivisionError);
    expect(err.key).toBe("a");
  });

  it("tags the thrown error with the failing result key and formula", () => {
    const err = captureError(() => calc().solve({ ok: "1", boom: "1/0" }));
    expect(err).toBeInstanceOf(ZeroDivisionError);
    expect(err.key).toBe("boom");
    expect(err.formula).toBe("1/0");
  });
});

describe("nested keys", () => {
  it("round-trips nested result keys", () => {
    // Required by docs/issues/012-solver.md: nested keys flatten to
    // '.'-separated form for solving and expand back in the result.
    const c = calc();
    expect(c.solve({ a: { b: "1 + 1", c: "a.b * 2" } })).toEqual({ a: { b: 2, c: 4 } });
  });

  it("keys nested results by their flattened name in trySolve errors", () => {
    const { values, errors } = calc().trySolve({ a: { good: "1", bad: "1/0" } });
    expect(values).toEqual({ a: { good: 1 } });
    expect(errors["a.bad"]).toBeInstanceOf(ZeroDivisionError);
    expect(errors["a.bad"]?.key).toBe("a.bad");
  });
});

describe("solver state isolation", () => {
  it("never mutates calculator memory", () => {
    const c = calc().store({ x: 1 });
    expect(c.solve({ x: "x + 1", y: "x * 10" })).toEqual({ x: 2, y: 20 });
    expect(c.evaluate("x")).toBe(1);
    expect(c.dependencies("y")).toEqual(["y"]);
  });

  it("accepts per-call variables without persisting them", () => {
    const c = calc();
    expect(c.solve({ total: "price * qty" }, { price: 5, qty: 3 })).toEqual({ total: 15 });
    expect(() => c.evaluate("price")).toThrow(UnboundVariableError);
  });

  it("layers per-call variables over memory and batch results over both", () => {
    const c = calc().store({ price: 1, qty: 100 });
    expect(c.solve({ qty: "7", total: "price * qty" }, { price: 5 })).toEqual({
      qty: 7,
      total: 35,
    });
  });
});

describe("evaluation modes", () => {
  it("solve is strict and trySolve is permissive (mirrors evaluate/tryEvaluate)", () => {
    const batch = { m: "MAP(items, item, item.value)" };
    const vars = { items: [{ value: 1 }, {}] };
    // Strict mode propagates per-item enum errors...
    expect(() => calc().solve(batch, vars)).toThrow(UnboundVariableError);
    // ...permissive mode swallows them per item (Ruby :permissive parity).
    expect(calc().trySolve(batch, vars)).toEqual({
      values: { m: [1, null] },
      errors: {},
    });
  });
});

function captureError(fn: () => unknown): DentakuError {
  try {
    fn();
  } catch (error) {
    return error as DentakuError;
  }
  throw new Error("expected the callback to throw");
}
