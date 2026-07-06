import { describe, expect, it } from "vitest";
import { expand, flatten } from "../src/data/flatten.js";
import { Decimal } from "../src/decimal.js";
import type { CivilDateTime, Duration, Value } from "../src/values.js";

describe("flatten", () => {
  it("flattens nested objects into dot-separated keys", () => {
    const map = flatten({ a: { b: { c: "leaf" } }, d: true });
    expect([...map.entries()]).toEqual([
      ["a.b.c", "leaf"],
      ["d", true],
    ]);
  });

  it("treats arrays and value types as leaves", () => {
    const arr: Value = [new Decimal(1), new Decimal(2)];
    const n = new Decimal(9);
    const map = flatten({ list: arr, n });
    expect(map.get("list")).toBe(arr);
    expect(map.get("n")).toBe(n);
  });

  it("does not descend into CivilDateTime or Duration values", () => {
    const civil: CivilDateTime = {
      year: 2020,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    };
    const dur: Duration = { value: 1, unit: "day" };
    const map = flatten({ when: civil, span: dur });
    expect(map.get("when")).toBe(civil);
    expect(map.get("span")).toBe(dur);
    expect(map.size).toBe(2);
  });

  it("omits empty nested objects without intermediates", () => {
    expect(flatten({ a: {} }).size).toBe(0);
  });

  it("stores intermediate objects under their dotted key when requested", () => {
    const inner = { c: "leaf" };
    const outer = { b: inner };
    const map = flatten({ a: outer }, { intermediates: true });
    expect(map.get("a")).toBe(outer);
    expect(map.get("a.b")).toBe(inner);
    expect(map.get("a.b.c")).toBe("leaf");
    expect(map.size).toBe(3);
  });

  it("stores empty nested objects when intermediates is set", () => {
    const map = flatten({ a: {} }, { intermediates: true });
    expect(map.get("a")).toEqual({});
    expect(map.size).toBe(1);
  });
});

describe("expand", () => {
  it("rebuilds nested objects from dotted keys", () => {
    const obj = expand(
      new Map<string, Value>([
        ["a.b.c", "leaf"],
        ["a.b.d", true],
        ["e", null],
      ]),
    );
    expect(obj).toEqual({ a: { b: { c: "leaf", d: true } }, e: null });
  });

  it("round-trips flatten -> expand", () => {
    const original = {
      a: { b: { c: "leaf" }, x: false },
      list: [new Decimal(1)],
      n: new Decimal(5),
    };
    expect(expand(flatten(original))).toEqual(original);
  });

  it("round-trips with intermediates enabled", () => {
    const original = { a: { b: { c: "leaf" } }, d: "top" };
    expect(expand(flatten(original, { intermediates: true }))).toEqual(original);
  });

  it("does not mutate objects supplied as intermediate values", () => {
    const inner = { c: "leaf" };
    const map = flatten({ a: { b: inner } }, { intermediates: true });
    const result = expand(map);
    expect(result).toEqual({ a: { b: { c: "leaf" } } });
    expect(inner).toEqual({ c: "leaf" }); // untouched
  });

  it("lets later keys overwrite non-object intermediates", () => {
    const obj = expand(
      new Map<string, Value>([
        ["a", "scalar"],
        ["a.b", "nested"],
      ]),
    );
    expect(obj).toEqual({ a: { b: "nested" } });
  });
});
