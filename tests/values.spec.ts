import { describe, expect, it } from "vitest";
import { Decimal } from "../src/decimal.js";
import { TypeMismatchError } from "../src/errors.js";
import {
  type CivilDateTime,
  civilDateTimeFromDate,
  type Duration,
  toExternal,
  toInternal,
  type Value,
  valueType,
} from "../src/values.js";

describe("decimal configuration", () => {
  it("uses precision 20 with ROUND_HALF_UP", () => {
    expect(Decimal.precision).toBe(20);
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it("keeps decimal arithmetic exact", () => {
    expect(new Decimal("0.1").plus("0.2").equals("0.3")).toBe(true);
  });
});

describe("toInternal", () => {
  it("converts number to Decimal", () => {
    const v = toInternal(2.5);
    expect(v).toBeInstanceOf(Decimal);
    expect((v as Decimal).toNumber()).toBe(2.5);
  });

  it("converts bigint to Decimal exactly", () => {
    const big = 12345678901234567890123n;
    const v = toInternal(big);
    expect(v).toBeInstanceOf(Decimal);
    expect((v as Decimal).toFixed()).toBe("12345678901234567890123");
  });

  it("rejects NaN with TypeMismatchError", () => {
    expect(() => toInternal(Number.NaN)).toThrow(TypeMismatchError);
  });

  it("rejects +Infinity and -Infinity with TypeMismatchError", () => {
    expect(() => toInternal(Number.POSITIVE_INFINITY)).toThrow(TypeMismatchError);
    expect(() => toInternal(Number.NEGATIVE_INFINITY)).toThrow(TypeMismatchError);
  });

  it("passes string, boolean, and null through unchanged", () => {
    expect(toInternal("hello")).toBe("hello");
    expect(toInternal(true)).toBe(true);
    expect(toInternal(false)).toBe(false);
    expect(toInternal(null)).toBeNull();
  });

  it("converts Date to CivilDateTime using UTC fields", () => {
    const d = new Date(Date.UTC(2020, 0, 31, 12, 34, 56, 789));
    const v = toInternal(d) as CivilDateTime;
    expect(v).toEqual({
      year: 2020,
      month: 1,
      day: 31,
      hour: 12,
      minute: 34,
      second: 56,
      millisecond: 789,
    });
  });

  it("converts arrays and nested objects recursively", () => {
    const v = toInternal({ a: [1, "x", null], b: { c: 2 } });
    expect(valueType(v)).toBe("object");
    const obj = v as { readonly [k: string]: Value };
    const arr = obj.a as Value[];
    expect(arr[0]).toBeInstanceOf(Decimal);
    expect(arr[1]).toBe("x");
    expect(arr[2]).toBeNull();
    const inner = obj.b as { readonly [k: string]: Value };
    expect(inner.c).toBeInstanceOf(Decimal);
  });
});

describe("toExternal", () => {
  it("converts Decimal to number", () => {
    expect(toExternal(new Decimal("2.5"))).toBe(2.5);
  });

  it("converts CivilDateTime to a UTC Date", () => {
    const civil: CivilDateTime = {
      year: 2020,
      month: 2,
      day: 29,
      hour: 1,
      minute: 2,
      second: 3,
      millisecond: 4,
    };
    const d = toExternal(civil) as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(Date.UTC(2020, 1, 29, 1, 2, 3, 4));
  });

  it("is identity for string, boolean, and null", () => {
    expect(toExternal("hi")).toBe("hi");
    expect(toExternal(true)).toBe(true);
    expect(toExternal(null)).toBeNull();
  });

  it("converts arrays and nested objects recursively", () => {
    const out = toExternal({ a: [new Decimal(1), "x"], b: { c: new Decimal(2) } });
    expect(out).toEqual({ a: [1, "x"], b: { c: 2 } });
  });
});

describe("round-trips", () => {
  it("toExternal(toInternal(x)) preserves plain external values", () => {
    const external = {
      n: 1.25,
      s: "str",
      b: false,
      z: null,
      list: [1, 2, [3, "four"]],
      nested: { deep: { val: 42 } },
    };
    expect(toExternal(toInternal(external))).toEqual(external);
  });

  it("toExternal(toInternal(date)) preserves the instant", () => {
    const d = new Date(Date.UTC(1999, 11, 31, 23, 59, 59, 999));
    const back = toExternal(toInternal(d)) as Date;
    expect(back.getTime()).toBe(d.getTime());
  });

  it("civilDateTimeFromDate round-trips through toExternal", () => {
    const d = new Date(Date.UTC(2021, 5, 15, 8, 30));
    const civil = civilDateTimeFromDate(d);
    expect((toExternal(civil) as Date).getTime()).toBe(d.getTime());
  });
});

describe("valueType", () => {
  const civil: CivilDateTime = {
    year: 2020,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  };
  const duration: Duration = { value: 3, unit: "month" };

  it.each<[Value, string]>([
    [new Decimal(1), "numeric"],
    ["x", "string"],
    [true, "logical"],
    [false, "logical"],
    [null, "null"],
    [civil, "datetime"],
    [duration, "duration"],
    [[new Decimal(1)], "array"],
    [{ a: new Decimal(1) }, "object"],
    [{}, "object"],
  ])("classifies %o as %s", (value, expected) => {
    expect(valueType(value)).toBe(expected);
  });

  it("does not mistake objects with similar keys for duration", () => {
    // unit outside the enum, or non-number value, is a plain object
    expect(valueType({ value: new Decimal(1), unit: "day" })).toBe("object");
    expect(valueType({ value: "3", unit: "hour" })).toBe("object");
  });
});
