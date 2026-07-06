// AST cache behavior (issue 011): keyed by formula string, enabled via the
// `astCache` constructor option (true = internal Map, or bring-your-own Map).
// There is deliberately no loadCache/clearCache surface (PLAN.md keeps the
// host API minimal); owners of a bring-your-own Map clear it themselves.
//
// The tokenizer module is wrapped with a passthrough spy so "parses once"
// is observable directly.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/tokenizer/tokenizer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/tokenizer/tokenizer.js")>();
  return { ...actual, tokenize: vi.fn(actual.tokenize) };
});

import { Calculator } from "../src/calculator.js";
import type { Node } from "../src/index.js";
import { tokenize } from "../src/tokenizer/tokenizer.js";

const tokenizeSpy = vi.mocked(tokenize);

beforeEach(() => {
  tokenizeSpy.mockClear();
});

describe("astCache", () => {
  it("parses a repeated formula once, and different vars still re-evaluate", () => {
    const c = new Calculator({ astCache: true });
    expect(c.evaluate("x + 1", { x: 1 })).toBe(2);
    expect(c.evaluate("x + 1", { x: 41 })).toBe(42);
    expect(c.evaluate("x + 1", { x: -1 })).toBe(0);
    expect(tokenizeSpy).toHaveBeenCalledTimes(1);
  });

  it("is disabled by default (every call parses)", () => {
    const c = new Calculator();
    expect(c.evaluate("1 + 1")).toBe(2);
    expect(c.evaluate("1 + 1")).toBe(2);
    expect(tokenizeSpy).toHaveBeenCalledTimes(2);
  });

  it("caches per formula string", () => {
    const c = new Calculator({ astCache: true });
    c.evaluate("1 + 1");
    c.evaluate("2 + 2");
    c.evaluate("1 + 1");
    expect(tokenizeSpy).toHaveBeenCalledTimes(2);
  });

  it("returns the identical Node for a cached formula", () => {
    const cached = new Calculator({ astCache: true });
    expect(cached.ast("1 + 1")).toBe(cached.ast("1 + 1"));
    const uncached = new Calculator();
    expect(uncached.ast("1 + 1")).not.toBe(uncached.ast("1 + 1"));
  });

  it("accepts a bring-your-own Map (owner controls clearing)", () => {
    const cache = new Map<string, Node>();
    const c = new Calculator({ astCache: cache });
    c.evaluate("x * 2", { x: 3 });
    expect(cache.size).toBe(1);
    expect(cache.has("x * 2")).toBe(true);
    c.evaluate("x * 2", { x: 4 });
    expect(tokenizeSpy).toHaveBeenCalledTimes(1);

    // Clearing the cache is clearing your own Map.
    cache.clear();
    expect(c.evaluate("x * 2", { x: 5 })).toBe(10);
    expect(tokenizeSpy).toHaveBeenCalledTimes(2);
  });

  it("shares a bring-your-own Map across calculators", () => {
    const cache = new Map<string, Node>();
    const a = new Calculator({ astCache: cache });
    const b = new Calculator({ astCache: cache });
    expect(a.evaluate("6 * 7")).toBe(42);
    expect(b.evaluate("6 * 7")).toBe(42);
    expect(tokenizeSpy).toHaveBeenCalledTimes(1);
  });

  it("internal Maps are per-calculator (astCache: true shares nothing)", () => {
    const a = new Calculator({ astCache: true });
    const b = new Calculator({ astCache: true });
    a.evaluate("6 * 7");
    b.evaluate("6 * 7");
    expect(tokenizeSpy).toHaveBeenCalledTimes(2);
  });

  it("is used by storeFormula and dependencies too", () => {
    const c = new Calculator({ astCache: true });
    c.storeFormula("area", "length * width");
    expect(c.dependencies("length * width")).toEqual(["length", "width"]);
    expect(c.evaluate("area", { length: 2, width: 3 })).toBe(6);
    // "length * width" once, "area" once.
    expect(tokenizeSpy).toHaveBeenCalledTimes(2);
  });
});
