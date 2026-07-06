// Value model and boundary conversions (PLAN.md "Value model", ADR-0001, ADR-0004).
// Internal code works exclusively with `Value`; `toInternal`/`toExternal` convert
// exactly once at the host boundary.
import { Decimal } from "./decimal.js";
import { TypeMismatchError } from "./errors.js";

/**
 * A civil (timezone-less) date-time. Declared here as an interface (fields only);
 * issue 004 provides the class with month-clamped arithmetic, which is assignable
 * to this interface.
 */
export interface CivilDateTime {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

export type DurationUnit = "year" | "month" | "day";

/**
 * A calendar duration as produced by `duration(n, unit)`. Declared here as an
 * interface (fields only); issue 004 provides the class.
 */
export interface Duration {
  readonly value: number;
  readonly unit: DurationUnit;
}

/** The internal value union every AST node produces and consumes. */
export type Value =
  | Decimal
  | string
  | boolean
  | null
  | CivilDateTime
  | Duration
  | Value[]
  | { readonly [k: string]: Value };

/** The external value union accepted from and returned to host code. */
export type ExternalValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | Date
  | ExternalValue[]
  | { [k: string]: ExternalValue };

export type ValueType =
  | "numeric"
  | "string"
  | "logical"
  | "null"
  | "datetime"
  | "duration"
  | "array"
  | "object";

/**
 * Converts a JS Date to a CivilDateTime using its UTC fields.
 *
 * Returns a plain object satisfying the interface; issue 004's CivilDateTime
 * class supersedes this as the canonical constructor, but the plain object
 * remains a valid `CivilDateTime` (the interface is fields-only by design).
 */
export function civilDateTimeFromDate(d: Date): CivilDateTime {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

const DURATION_UNITS: ReadonlySet<string> = new Set(["year", "month", "day"]);

/**
 * Duck-typed guard for CivilDateTime. Sound within the value model: `number`
 * fields cannot otherwise occur inside a `Value` (numbers become Decimal at the
 * boundary), so only genuine civil date-times match.
 */
export function isCivilDateTime(v: Value): v is CivilDateTime {
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Decimal) {
    return false;
  }
  const o = v as { readonly [k: string]: unknown };
  return (
    typeof o.year === "number" &&
    typeof o.month === "number" &&
    typeof o.day === "number" &&
    typeof o.hour === "number" &&
    typeof o.minute === "number" &&
    typeof o.second === "number" &&
    typeof o.millisecond === "number"
  );
}

/** Duck-typed guard for Duration. Sound for the same reason as isCivilDateTime. */
export function isDuration(v: Value): v is Duration {
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Decimal) {
    return false;
  }
  const o = v as { readonly [k: string]: unknown };
  return typeof o.value === "number" && typeof o.unit === "string" && DURATION_UNITS.has(o.unit);
}

/**
 * Converts an external (host) value to the internal value union.
 * number → Decimal (NaN and ±Infinity are rejected with TypeMismatchError),
 * bigint → Decimal, Date → CivilDateTime; arrays/objects convert recursively.
 */
export function toInternal(v: ExternalValue): Value {
  if (v === null) {
    return null;
  }
  switch (typeof v) {
    case "number":
      if (!Number.isFinite(v)) {
        throw new TypeMismatchError(`Cannot convert non-finite number ${v} to a value`);
      }
      return new Decimal(v);
    case "bigint":
      return new Decimal(v.toString());
    case "string":
    case "boolean":
      return v;
    default:
      break;
  }
  if (v instanceof Date) {
    return civilDateTimeFromDate(v);
  }
  if (Array.isArray(v)) {
    return v.map(toInternal);
  }
  if (typeof v === "object") {
    const out: { [k: string]: Value } = {};
    for (const [k, item] of Object.entries(v)) {
      out[k] = toInternal(item);
    }
    return out;
  }
  throw new TypeMismatchError(`Cannot convert value of type ${typeof v} to a value`);
}

/**
 * Converts an internal value to the external union.
 * Decimal → number, CivilDateTime → Date (UTC fields); identity otherwise
 * (Duration passes through as a plain `{value, unit}` object).
 */
export function toExternal(v: Value): ExternalValue {
  if (v === null || typeof v === "string" || typeof v === "boolean") {
    return v;
  }
  if (v instanceof Decimal) {
    return v.toNumber();
  }
  if (Array.isArray(v)) {
    return v.map(toExternal);
  }
  if (isDuration(v)) {
    return { value: v.value, unit: v.unit };
  }
  if (isCivilDateTime(v)) {
    return new Date(
      Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second, v.millisecond),
    );
  }
  const out: { [k: string]: ExternalValue } = {};
  for (const [k, item] of Object.entries(v)) {
    out[k] = toExternal(item);
  }
  return out;
}

/** Classifies an internal value by its formula-language type. */
export function valueType(v: Value): ValueType {
  if (v === null) {
    return "null";
  }
  switch (typeof v) {
    case "string":
      return "string";
    case "boolean":
      return "logical";
    default:
      break;
  }
  if (v instanceof Decimal) {
    return "numeric";
  }
  if (Array.isArray(v)) {
    return "array";
  }
  if (isDuration(v)) {
    return "duration";
  }
  if (isCivilDateTime(v)) {
    return "datetime";
  }
  return "object";
}
