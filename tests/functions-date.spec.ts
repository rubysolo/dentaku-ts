// Date function pack (issue 010): date() and duration().
//
// date() is new in dentaku-ts (ADR-0004): dates originate in formulas only via
// date("ISO") / date(y, m, d), replacing Ruby's eval-time string→date coercion.
// duration() ports Ruby ast/functions/duration.rb, including the unbound-unit
// identifier behavior of `duration(1, month)`.
import { describe, expect, it } from "vitest";
import { Scope } from "../src/ast/index.js";
import type { Binding } from "../src/ast/node.js";
import { CivilDateTime, Duration } from "../src/civil-date.js";
import { Decimal } from "../src/decimal.js";
import { ArgumentCountError, ParseError, TypeMismatchError } from "../src/errors.js";
import { dateFunctions } from "../src/functions/date.js";
import { FunctionSet } from "../src/functions/registry.js";
import { parseFormula } from "../src/parser/parser.js";
import type { Value } from "../src/values.js";

const registry = new FunctionSet(dateFunctions);

function evaluate(formula: string, vars: Record<string, Binding> = {}): Value {
  return parseFormula(formula, { registry }).value(Scope.of(vars));
}

function civil(formula: string, vars: Record<string, Binding> = {}): CivilDateTime {
  const v = evaluate(formula, vars);
  expect(v).toBeInstanceOf(CivilDateTime);
  return v as CivilDateTime;
}

describe("date(): string form", () => {
  it("parses an ISO-8601 date", () => {
    expect(civil('date("2026-07-04")').toISO()).toBe("2026-07-04");
  });

  it("parses a full ISO-8601 datetime", () => {
    expect(civil('date("2026-07-04T12:30:05")').toISO()).toBe("2026-07-04T12:30:05");
    expect(civil('date("2026-07-04 12:30:05")').toISO()).toBe("2026-07-04T12:30:05");
  });

  it("accepts leap days", () => {
    expect(civil('date("2024-02-29")').toISO()).toBe("2024-02-29");
  });

  it("rejects unparseable strings with the offending string in the message", () => {
    expect(() => evaluate('date("not-a-date")')).toThrow(TypeMismatchError);
    expect(() => evaluate('date("not-a-date")')).toThrow(/not-a-date/);
  });

  it("rejects calendar-impossible strings", () => {
    expect(() => evaluate('date("2023-02-29")')).toThrow(TypeMismatchError);
    expect(() => evaluate('date("2026-13-01")')).toThrow(TypeMismatchError);
  });

  it("rejects a single non-string argument", () => {
    expect(() => evaluate("date(42)")).toThrow(TypeMismatchError);
  });
});

describe("date(): numeric form", () => {
  it("builds a date from year, month, day", () => {
    expect(civil("date(2026, 7, 4)").toISO()).toBe("2026-07-04");
  });

  it("accepts variables", () => {
    const vars = { y: new Decimal(2026), m: new Decimal(7), d: new Decimal(4) };
    expect(civil("date(y, m, d)", vars).toISO()).toBe("2026-07-04");
  });

  it("validates a real calendar date", () => {
    expect(civil("date(2024, 2, 29)").toISO()).toBe("2024-02-29");
    expect(() => evaluate("date(2023, 2, 29)")).toThrow(TypeMismatchError);
    expect(() => evaluate("date(2026, 13, 1)")).toThrow(TypeMismatchError);
    expect(() => evaluate("date(2026, 4, 31)")).toThrow(TypeMismatchError);
  });

  it("rejects non-integer and non-numeric fields", () => {
    expect(() => evaluate("date(2026.5, 7, 4)")).toThrow(TypeMismatchError);
    expect(() => evaluate('date(2026, "7", 4)')).toThrow(TypeMismatchError);
  });

  it("rejects two arguments at evaluation time", () => {
    expect(() => evaluate("date(2026, 7)")).toThrow(ArgumentCountError);
  });

  it("enforces 1..3 arguments at parse time", () => {
    expect(() => parseFormula("date()", { registry })).toThrow(ParseError);
    expect(() => parseFormula("date(2026, 7, 4, 12)", { registry })).toThrow(ParseError);
  });

  it("is case-insensitive by function name", () => {
    expect(civil("DATE(2026, 7, 4)").toISO()).toBe("2026-07-04");
  });
});

describe("duration()", () => {
  it("accepts a bare unit identifier without resolving it (Ruby parity)", () => {
    const d = evaluate("duration(1, month)");
    expect(d).toBeInstanceOf(Duration);
    expect((d as Duration).value).toBe(1);
    expect((d as Duration).unit).toBe("month");
  });

  it("accepts plural units", () => {
    const d = evaluate("duration(2, days)") as Duration;
    expect(d.value).toBe(2);
    expect(d.unit).toBe("day");
  });

  it("accepts a string-literal unit, case-insensitively", () => {
    const d = evaluate('duration(3, "Years")') as Duration;
    expect(d.value).toBe(3);
    expect(d.unit).toBe("year");
  });

  it("normalizes identifier unit case", () => {
    expect((evaluate("duration(4, MONTHS)") as Duration).unit).toBe("month");
  });

  it("reads the unit identifier's name even when that identifier is bound", () => {
    // Ruby uses unit_node.identifier — the binding for `month` is ignored.
    const d = evaluate("duration(1, month)", { month: "shadow" }) as Duration;
    expect(d.unit).toBe("month");
  });

  it("evaluates the value argument through the context", () => {
    const d = evaluate("duration(n + 1, days)", { n: new Decimal(2) }) as Duration;
    expect(d.value).toBe(3);
  });

  it("rejects unknown units with TypeMismatchError", () => {
    expect(() => evaluate("duration(1, fortnight)")).toThrow(TypeMismatchError);
    expect(() => evaluate("duration(1, fortnight)")).toThrow(/fortnight/);
    expect(() => evaluate('duration(1, "weeks")')).toThrow(TypeMismatchError);
  });

  it("rejects a non-identifier, non-string unit argument at parse time", () => {
    expect(() => parseFormula("duration(1, 2)", { registry })).toThrow(ParseError);
    expect(() => parseFormula("duration(1, 1 + 1)", { registry })).toThrow(ParseError);
  });

  it("rejects non-numeric values", () => {
    expect(() => evaluate('duration("one", month)')).toThrow(TypeMismatchError);
  });

  it("rejects non-integer values (issue 004 Duration contract)", () => {
    expect(() => evaluate("duration(1.5, days)")).toThrow(TypeMismatchError);
  });

  it("reports dependencies from the value argument only (Ruby parity)", () => {
    expect(parseFormula("duration(n, months)", { registry }).dependencies()).toEqual(["n"]);
    expect(parseFormula("duration(2, months)", { registry }).dependencies()).toEqual([]);
  });
});

describe("date arithmetic integration (issue 006 evaluator)", () => {
  it('date("2020-01-31") + duration(1, month) clamps to 2020-02-29', () => {
    expect(civil('date("2020-01-31") + duration(1, month)').toISO()).toBe("2020-02-29");
  });

  it("subtracts durations with the same clamping", () => {
    expect(civil('date("2020-03-31") - duration(1, month)').toISO()).toBe("2020-02-29");
  });

  it("adds year durations across a leap day", () => {
    expect(civil("date(2020, 2, 29) + duration(1, year)").toISO()).toBe("2021-02-28");
  });

  it("adds plain numeric days", () => {
    expect(civil('date("2026-07-04") + 3').toISO()).toBe("2026-07-07");
  });
});
