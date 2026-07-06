import { describe, expect, it } from "vitest";
import { defaultFunctionSet } from "../src/functions/builtins.js";
import { collectionFunctions } from "../src/functions/collection.js";
import { dateFunctions } from "../src/functions/date.js";
import { logicFunctions } from "../src/functions/logic.js";
import { mathFunctions } from "../src/functions/math.js";
import { numericFunctions } from "../src/functions/numeric.js";
import { FunctionRegistry, FunctionSet } from "../src/functions/registry.js";
import { stringFunctions } from "../src/functions/string.js";
import type { FunctionDef } from "../src/functions/types.js";

const def = (name: string): FunctionDef => ({
  name,
  returnType: "numeric",
  fn: () => null,
});

describe("FunctionRegistry", () => {
  it("stores and looks up names case-insensitively", () => {
    const registry = new FunctionRegistry();
    registry.add(def("Round"));
    expect(registry.get("round")?.name).toBe("Round");
    expect(registry.get("ROUND")?.name).toBe("Round");
    expect(registry.get("rOuNd")?.name).toBe("Round");
  });

  it("returns undefined for unknown names", () => {
    expect(new FunctionRegistry().get("nope")).toBeUndefined();
  });

  it("replaces a def registered under the same case-folded name", () => {
    const registry = new FunctionRegistry();
    registry.add(def("sum"));
    const replacement = def("SUM");
    registry.add(replacement);
    expect(registry.get("sum")).toBe(replacement);
  });

  it("is seeded from a FunctionSet", () => {
    const set = new FunctionSet([def("min"), def("MAX")]);
    const registry = new FunctionRegistry(set);
    expect(registry.get("MIN")?.name).toBe("min");
    expect(registry.get("max")?.name).toBe("MAX");
  });

  it("mutating a seeded registry does not affect the FunctionSet", () => {
    const set = new FunctionSet([def("min")]);
    const registry = new FunctionRegistry(set);
    registry.add(def("extra"));
    expect(set.get("extra")).toBeUndefined();
    expect(set.size).toBe(1);
  });
});

describe("FunctionSet", () => {
  it("looks up case-insensitively", () => {
    const set = new FunctionSet([def("Concat")]);
    expect(set.get("CONCAT")?.name).toBe("Concat");
    expect(set.has("concat")).toBe(true);
    expect(set.has("other")).toBe(false);
  });

  it("withFunction returns a new set and leaves the original untouched", () => {
    const original = new FunctionSet([def("a")]);
    const extended = original.withFunction(def("b"));
    expect(extended).not.toBe(original);
    expect(extended.get("b")).toBeDefined();
    expect(extended.size).toBe(2);
    expect(original.get("b")).toBeUndefined();
    expect(original.size).toBe(1);
  });

  it("withFunction replaces a same-named def in the new set only", () => {
    const first = def("fn");
    const second = def("FN");
    const original = new FunctionSet([first]);
    const extended = original.withFunction(second);
    expect(extended.get("fn")).toBe(second);
    expect(original.get("fn")).toBe(first);
  });

  it("withFunctions adds several defs at once", () => {
    const set = new FunctionSet().withFunctions([def("a"), def("b")]);
    expect(set.size).toBe(2);
  });

  it("is iterable over its defs", () => {
    const defs = [def("a"), def("b")];
    expect([...new FunctionSet(defs)]).toEqual(defs);
  });
});

describe("defaultFunctionSet", () => {
  // Pack-agnostic: stays green whichever subset of packs (issues 007-010) has
  // landed, replacing the "empty until packs land" placeholder from issue 003.
  it("aggregates exactly the landed pack defs", () => {
    expect(defaultFunctionSet).toBeInstanceOf(FunctionSet);
    const packDefs = [
      ...logicFunctions,
      ...numericFunctions,
      ...stringFunctions,
      ...collectionFunctions,
      ...dateFunctions,
      ...mathFunctions,
    ];
    const expectedNames = new Set(packDefs.map((d) => d.name.toLowerCase()));
    expect(defaultFunctionSet.size).toBe(expectedNames.size);
    for (const name of expectedNames) {
      expect(defaultFunctionSet.has(name)).toBe(true);
    }
  });
});
