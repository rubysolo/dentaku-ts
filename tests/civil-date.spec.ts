import { describe, expect, it } from "vitest";
import {
  applyDuration,
  CivilDateTime,
  Duration,
  daysInMonth,
  isLeapYear,
} from "../src/civil-date.js";
import { Decimal } from "../src/decimal.js";
import { TypeMismatchError } from "../src/errors.js";
import {
  type CivilDateTime as CivilDateTimeFields,
  civilDateTimeFromDate,
  isCivilDateTime,
  isDuration,
  toExternal,
  valueType,
} from "../src/values.js";

describe("calendar helpers", () => {
  it("computes leap years (Gregorian rules)", () => {
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2019)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("computes days in month", () => {
    expect(daysInMonth(2020, 2)).toBe(29);
    expect(daysInMonth(2019, 2)).toBe(28);
    expect(daysInMonth(2021, 4)).toBe(30);
    expect(daysInMonth(2021, 12)).toBe(31);
  });
});

describe("CivilDateTime.of", () => {
  it("constructs with time defaulting to midnight", () => {
    const d = CivilDateTime.of(2020, 2, 29);
    expect(d.year).toBe(2020);
    expect(d.month).toBe(2);
    expect(d.day).toBe(29);
    expect(d.hour).toBe(0);
    expect(d.minute).toBe(0);
    expect(d.second).toBe(0);
    expect(d.millisecond).toBe(0);
  });

  it("accepts full time fields", () => {
    const d = CivilDateTime.of(1999, 12, 31, 23, 59, 59, 999);
    expect(d.toISO()).toBe("1999-12-31T23:59:59.999");
  });

  it("rejects calendar-impossible dates", () => {
    expect(() => CivilDateTime.of(2019, 2, 29)).toThrow(TypeMismatchError); // not a leap year
    expect(() => CivilDateTime.of(2021, 4, 31)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 13, 1)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 0, 1)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 1, 0)).toThrow(TypeMismatchError);
  });

  it("rejects out-of-range and non-integer time fields", () => {
    expect(() => CivilDateTime.of(2021, 1, 1, 24)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 1, 1, 0, 60)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 1, 1, 0, 0, 60)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 1, 1, 0, 0, 0, 1000)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(2021, 1, 1.5)).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.of(Number.NaN, 1, 1)).toThrow(TypeMismatchError);
  });
});

describe("CivilDateTime.parseISO", () => {
  it("parses date-only form", () => {
    const d = CivilDateTime.parseISO("2026-07-04");
    expect(d.equals(CivilDateTime.of(2026, 7, 4))).toBe(true);
  });

  it("parses T and space separators", () => {
    const t = CivilDateTime.parseISO("2026-07-04T12:34:56");
    const s = CivilDateTime.parseISO("2026-07-04 12:34:56");
    expect(t.equals(CivilDateTime.of(2026, 7, 4, 12, 34, 56))).toBe(true);
    expect(t.equals(s)).toBe(true);
  });

  it("parses fractional seconds, right-padding to milliseconds", () => {
    expect(CivilDateTime.parseISO("2026-07-04T00:00:00.5").millisecond).toBe(500);
    expect(CivilDateTime.parseISO("2026-07-04T00:00:00.05").millisecond).toBe(50);
    expect(CivilDateTime.parseISO("2026-07-04T00:00:00.123").millisecond).toBe(123);
  });

  it("treats Z as a zero offset", () => {
    const d = CivilDateTime.parseISO("2026-07-04T12:00:00Z");
    expect(d.toISO()).toBe("2026-07-04T12:00:00");
  });

  it("normalizes positive offsets to UTC-equivalent civil time, then discards them", () => {
    // +02:00 wall clock midnight is 22:00 UTC the previous day.
    const d = CivilDateTime.parseISO("2020-01-01T00:00:00+02:00");
    expect(d.toISO()).toBe("2019-12-31T22:00:00");
  });

  it("normalizes negative offsets across a day boundary", () => {
    const d = CivilDateTime.parseISO("2020-12-31T23:30:00-05:00");
    expect(d.toISO()).toBe("2021-01-01T04:30:00");
  });

  it("normalizes half-hour offsets", () => {
    const d = CivilDateTime.parseISO("2026-07-04T10:00:00+05:30");
    expect(d.toISO()).toBe("2026-07-04T04:30:00");
  });

  it("rejects malformed input", () => {
    for (const bad of [
      "",
      "hello",
      "2020-1-1", // unpadded (bare date literals are a tokenizer concern, not ISO)
      "2020/01/01",
      "2020-01-01T12:00", // seconds are required in the time form
      "2020-01-01T12:00:00.1234", // more than millisecond precision
      "2020-01-01T12:00:00+0200", // offset must be ±HH:MM
      "2020-02-30",
      "2020-13-01",
      "2020-01-01T24:00:00",
    ]) {
      expect(() => CivilDateTime.parseISO(bad), bad).toThrow(TypeMismatchError);
    }
  });

  it("rejects out-of-range offsets", () => {
    expect(() => CivilDateTime.parseISO("2020-01-01T00:00:00+24:00")).toThrow(TypeMismatchError);
    expect(() => CivilDateTime.parseISO("2020-01-01T00:00:00+02:60")).toThrow(TypeMismatchError);
  });
});

describe("fromDate / toDate boundary", () => {
  it("fromDate uses the Date's UTC fields", () => {
    const d = CivilDateTime.fromDate(new Date(Date.UTC(2020, 0, 31, 12, 34, 56, 789)));
    expect(d.toISO()).toBe("2020-01-31T12:34:56.789");
  });

  it("toDate round-trips the instant", () => {
    const original = new Date(Date.UTC(1999, 11, 31, 23, 59, 59, 999));
    expect(CivilDateTime.fromDate(original).toDate().getTime()).toBe(original.getTime());
  });

  it("toDate handles years 0-99 without the Date.UTC century mapping", () => {
    const d = CivilDateTime.of(50, 6, 15).toDate();
    expect(d.getUTCFullYear()).toBe(50);
    expect(d.getUTCMonth()).toBe(5);
    expect(d.getUTCDate()).toBe(15);
  });

  it("rejects an Invalid Date", () => {
    expect(() => CivilDateTime.fromDate(new Date(Number.NaN))).toThrow(TypeMismatchError);
  });
});

describe("addDays", () => {
  it("adds within a month and preserves time of day", () => {
    const d = CivilDateTime.of(2021, 3, 10, 6, 30).addDays(5);
    expect(d.toISO()).toBe("2021-03-15T06:30:00");
  });

  it("crosses month and year boundaries", () => {
    expect(CivilDateTime.of(2020, 12, 31).addDays(1).toISO()).toBe("2021-01-01");
    expect(CivilDateTime.of(2020, 2, 28).addDays(1).toISO()).toBe("2020-02-29");
    expect(CivilDateTime.of(2019, 2, 28).addDays(1).toISO()).toBe("2019-03-01");
  });

  it("accepts negative counts", () => {
    expect(CivilDateTime.of(2021, 1, 1).addDays(-1).toISO()).toBe("2020-12-31");
    expect(CivilDateTime.of(2020, 3, 1).addDays(-1).toISO()).toBe("2020-02-29");
  });

  it("rejects non-integer counts", () => {
    expect(() => CivilDateTime.of(2021, 1, 1).addDays(1.5)).toThrow(TypeMismatchError);
  });
});

describe("addMonths (Ruby Date#>> clamping)", () => {
  it("2020-01-31 + 1 month = 2020-02-29 (leap year clamp)", () => {
    expect(CivilDateTime.of(2020, 1, 31).addMonths(1).toISO()).toBe("2020-02-29");
  });

  it("2019-01-31 + 1 month = 2019-02-28 (non-leap clamp)", () => {
    expect(CivilDateTime.of(2019, 1, 31).addMonths(1).toISO()).toBe("2019-02-28");
  });

  it("keeps the day when the target month has it", () => {
    expect(CivilDateTime.of(2020, 1, 31).addMonths(2).toISO()).toBe("2020-03-31");
    expect(CivilDateTime.of(2020, 1, 15).addMonths(1).toISO()).toBe("2020-02-15");
  });

  it("clamps going backwards too", () => {
    expect(CivilDateTime.of(2020, 3, 31).addMonths(-1).toISO()).toBe("2020-02-29");
    expect(CivilDateTime.of(2019, 3, 31).addMonths(-1).toISO()).toBe("2019-02-28");
  });

  it("crosses year boundaries in both directions", () => {
    expect(CivilDateTime.of(2020, 11, 30).addMonths(3).toISO()).toBe("2021-02-28");
    expect(CivilDateTime.of(2020, 1, 15).addMonths(-13).toISO()).toBe("2018-12-15");
  });

  it("preserves time of day and is a no-op for n = 0", () => {
    expect(CivilDateTime.of(2020, 1, 31, 8, 15, 30, 250).addMonths(1).toISO()).toBe(
      "2020-02-29T08:15:30.250",
    );
    expect(CivilDateTime.of(2020, 1, 31).addMonths(0).toISO()).toBe("2020-01-31");
  });

  it("rejects non-integer counts", () => {
    expect(() => CivilDateTime.of(2020, 1, 1).addMonths(0.5)).toThrow(TypeMismatchError);
  });
});

describe("addYears", () => {
  it("2020-02-29 + 1 year = 2021-02-28 (leap day clamp)", () => {
    expect(CivilDateTime.of(2020, 2, 29).addYears(1).toISO()).toBe("2021-02-28");
  });

  it("2020-02-29 + 4 years = 2024-02-29 (leap to leap keeps the day)", () => {
    expect(CivilDateTime.of(2020, 2, 29).addYears(4).toISO()).toBe("2024-02-29");
  });

  it("subtracts years", () => {
    expect(CivilDateTime.of(2020, 2, 29).addYears(-1).toISO()).toBe("2019-02-28");
  });
});

describe("diffDays (Ruby DateTime subtraction parity)", () => {
  it("returns whole days as a Decimal when times of day match", () => {
    const diff = CivilDateTime.of(2020, 3, 1).diffDays(CivilDateTime.of(2020, 2, 28));
    expect(diff).toBeInstanceOf(Decimal);
    expect(diff.toNumber()).toBe(2); // leap year: Feb 29 in between
  });

  it("returns fractional days when times of day differ", () => {
    const noon = CivilDateTime.of(2020, 1, 1, 12);
    const midnight = CivilDateTime.of(2020, 1, 1);
    expect(noon.diffDays(midnight).equals("0.5")).toBe(true);
    expect(midnight.diffDays(noon).equals("-0.5")).toBe(true);
  });

  it("combines whole and fractional parts across days", () => {
    const a = CivilDateTime.parseISO("2020-01-03T06:00:00");
    const b = CivilDateTime.parseISO("2020-01-01T18:00:00");
    expect(a.diffDays(b).equals("1.5")).toBe(true);
  });

  it("is zero for equal instants and accepts plain-object operands", () => {
    const a = CivilDateTime.of(2020, 6, 1, 3, 4, 5, 6);
    const plain = civilDateTimeFromDate(new Date(Date.UTC(2020, 5, 1, 3, 4, 5, 6)));
    expect(a.diffDays(plain).isZero()).toBe(true);
  });
});

describe("compare / equals", () => {
  it("orders chronologically", () => {
    const early = CivilDateTime.of(2020, 1, 1, 0, 0, 0, 1);
    const late = CivilDateTime.of(2020, 1, 1, 0, 0, 0, 2);
    expect(early.compare(late)).toBe(-1);
    expect(late.compare(early)).toBe(1);
    expect(early.compare(early)).toBe(0);
    expect(CivilDateTime.of(2019, 12, 31).compare(CivilDateTime.of(2020, 1, 1))).toBe(-1);
  });

  it("equals compares by value, including against plain interface objects", () => {
    const a = CivilDateTime.of(2020, 1, 1, 12);
    const plain: CivilDateTimeFields = {
      year: 2020,
      month: 1,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    };
    expect(a.equals(plain)).toBe(true);
    expect(a.equals(CivilDateTime.of(2020, 1, 1, 12, 0, 0, 1))).toBe(false);
  });
});

describe("toISO", () => {
  it("emits the date-only form at exactly midnight", () => {
    expect(CivilDateTime.of(2026, 7, 4).toISO()).toBe("2026-07-04");
  });

  it("emits the full form when any time field is nonzero", () => {
    expect(CivilDateTime.of(2026, 7, 4, 0, 0, 1).toISO()).toBe("2026-07-04T00:00:01");
    expect(CivilDateTime.of(2026, 7, 4, 9, 5, 0).toISO()).toBe("2026-07-04T09:05:00");
    expect(CivilDateTime.of(2026, 7, 4, 0, 0, 0, 7).toISO()).toBe("2026-07-04T00:00:00.007");
  });

  it("round-trips through parseISO", () => {
    for (const iso of ["2026-07-04", "2026-07-04T09:05:01", "2026-07-04T09:05:01.123"]) {
      expect(CivilDateTime.parseISO(iso).toISO()).toBe(iso);
    }
  });
});

describe("Duration", () => {
  it("holds value and unit; negate flips the sign", () => {
    const d = new Duration(3, "month");
    expect(d.value).toBe(3);
    expect(d.unit).toBe("month");
    const n = d.negate();
    expect(n.value).toBe(-3);
    expect(n.unit).toBe("month");
    expect(n.negate().value).toBe(3);
  });

  it("rejects non-integer values", () => {
    expect(() => new Duration(1.5, "day")).toThrow(TypeMismatchError);
  });

  it.each([
    ["year", "year"],
    ["years", "year"],
    ["YEAR", "year"],
    ["Months", "month"],
    ["month", "month"],
    ["day", "day"],
    ["DAYS", "day"],
  ])("parseUnit(%j) = %j", (raw, expected) => {
    expect(Duration.parseUnit(raw)).toBe(expected);
  });

  it("parseUnit throws TypeMismatchError on unknown units", () => {
    for (const bad of ["hour", "weeks", "d", "", "dayss", "monthly"]) {
      expect(() => Duration.parseUnit(bad), bad).toThrow(TypeMismatchError);
    }
  });
});

describe("applyDuration", () => {
  const base = CivilDateTime.of(2020, 1, 31);

  it("adds and subtracts day durations", () => {
    expect(applyDuration(base, new Duration(2, "day"), 1).toISO()).toBe("2020-02-02");
    expect(applyDuration(base, new Duration(31, "day"), -1).toISO()).toBe("2019-12-31");
  });

  it("adds month durations with clamping", () => {
    expect(applyDuration(base, new Duration(1, "month"), 1).toISO()).toBe("2020-02-29");
    expect(applyDuration(base, new Duration(11, "month"), -1).toISO()).toBe("2019-02-28");
  });

  it("adds year durations with leap-day clamping", () => {
    const leap = CivilDateTime.of(2020, 2, 29);
    expect(applyDuration(leap, new Duration(1, "year"), 1).toISO()).toBe("2021-02-28");
    expect(applyDuration(leap, new Duration(1, "year"), -1).toISO()).toBe("2019-02-28");
  });

  it("accepts plain-object bases and durations (the values.ts seam)", () => {
    const plainBase = civilDateTimeFromDate(new Date(Date.UTC(2020, 0, 31)));
    const result = applyDuration(plainBase, { value: 1, unit: "month" }, 1);
    expect(result.toISO()).toBe("2020-02-29");
  });
});

describe("interface compatibility with src/values.ts", () => {
  it("CivilDateTime instances satisfy the duck-typed guard and classify as datetime", () => {
    const d = CivilDateTime.of(2020, 1, 1, 12);
    expect(isCivilDateTime(d)).toBe(true);
    expect(valueType(d)).toBe("datetime");
  });

  it("Duration instances satisfy the duck-typed guard and classify as duration", () => {
    const d = new Duration(2, "year");
    expect(isDuration(d)).toBe(true);
    expect(valueType(d)).toBe("duration");
  });

  it("toExternal converts a CivilDateTime instance to the matching UTC Date", () => {
    const d = CivilDateTime.of(2020, 2, 29, 1, 2, 3, 4);
    const out = toExternal(d) as Date;
    expect(out).toBeInstanceOf(Date);
    expect(out.getTime()).toBe(Date.UTC(2020, 1, 29, 1, 2, 3, 4));
  });

  it("CivilDateTime.from upgrades the plain objects produced by civilDateTimeFromDate", () => {
    const plain = civilDateTimeFromDate(new Date(Date.UTC(2021, 5, 15, 8, 30)));
    const upgraded = CivilDateTime.from(plain);
    expect(upgraded).toBeInstanceOf(CivilDateTime);
    expect(upgraded.toISO()).toBe("2021-06-15T08:30:00");
    expect(CivilDateTime.from(upgraded)).toBe(upgraded);
  });
});
