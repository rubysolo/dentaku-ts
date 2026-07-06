// CivilDateTime + Duration value types (issue 004; ADR-0004, PLAN.md "Value model").
//
// A civil date-time is timezone-free: it names a position on the proleptic Gregorian
// calendar plus a time of day, with no attached UTC offset. Month arithmetic follows
// Ruby's `Date#>>`: shifting months keeps the day-of-month when possible and clamps
// to the last day of the target month otherwise (2020-01-31 >> 1 == 2020-02-29).
//
// No JS `Date` is used anywhere in this module except in the explicit boundary
// converters `CivilDateTime.fromDate` / `CivilDateTime.prototype.toDate` (ADR-0004).
// Calendar math uses Howard Hinnant's days-from-civil algorithms on the proleptic
// Gregorian calendar.
import { Decimal } from "./decimal.js";
import { TypeMismatchError } from "./errors.js";
import type {
  CivilDateTime as CivilDateTimeFields,
  Duration as DurationFields,
  DurationUnit,
} from "./values.js";

const MS_PER_DAY = 86_400_000;

/** True when `year` is a leap year on the proleptic Gregorian calendar. */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Number of days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

// Days since the epoch 1970-01-01 for a proleptic Gregorian civil date
// (Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms": days_from_civil).
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

// Inverse of daysFromCivil (Hinnant: civil_from_days).
function civilFromDays(z: number): { year: number; month: number; day: number } {
  const shifted = z + 719468;
  const era = Math.floor(shifted / 146097);
  const doe = shifted - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? y + 1 : y, month, day };
}

function requireInteger(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeMismatchError(`${what} must be an integer, got ${value}`);
  }
}

function requireRange(value: number, min: number, max: number, what: string): void {
  requireInteger(value, what);
  if (value < min || value > max) {
    throw new TypeMismatchError(`${what} must be between ${min} and ${max}, got ${value}`);
  }
}

function pad(n: number, width: number): string {
  return String(Math.abs(n)).padStart(width, "0");
}

function padYear(year: number): string {
  return year < 0 ? `-${pad(year, 4)}` : pad(year, 4);
}

// YYYY-MM-DD, optionally followed by a time part (T or space separator), which may
// carry fractional seconds (1-3 digits) and a Z / ±HH:MM offset.
const ISO_RE =
  /^(-?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * A civil (timezone-free) date-time value with Ruby-compatible calendar arithmetic.
 *
 * Implements (and is assignable to) the fields-only `CivilDateTime` interface in
 * `src/values.ts`, so instances flow through `toInternal`/`toExternal`, `valueType`,
 * and the duck-typed guards unchanged. Plain objects produced by
 * `civilDateTimeFromDate` can be upgraded to instances with `CivilDateTime.from`.
 */
export class CivilDateTime implements CivilDateTimeFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;

  private constructor(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    millisecond: number,
  ) {
    this.year = year;
    this.month = month;
    this.day = day;
    this.hour = hour;
    this.minute = minute;
    this.second = second;
    this.millisecond = millisecond;
  }

  /**
   * Constructs a validated civil date-time. The date must exist on the proleptic
   * Gregorian calendar (leap years respected); all fields must be integers.
   * Throws TypeMismatchError otherwise.
   */
  static of(
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
  ): CivilDateTime {
    requireInteger(year, "year");
    requireRange(month, 1, 12, "month");
    requireRange(day, 1, daysInMonth(year, month), `day of ${padYear(year)}-${pad(month, 2)}`);
    requireRange(hour, 0, 23, "hour");
    requireRange(minute, 0, 59, "minute");
    requireRange(second, 0, 59, "second");
    requireRange(millisecond, 0, 999, "millisecond");
    return new CivilDateTime(year, month, day, hour, minute, second, millisecond);
  }

  /** Upgrades any object satisfying the fields interface (validating it). */
  static from(fields: CivilDateTimeFields): CivilDateTime {
    if (fields instanceof CivilDateTime) {
      return fields;
    }
    return CivilDateTime.of(
      fields.year,
      fields.month,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second,
      fields.millisecond,
    );
  }

  /**
   * Parses an ISO-8601 civil date-time. Accepted forms:
   * - `YYYY-MM-DD`
   * - `YYYY-MM-DDTHH:MM:SS` (or with a space instead of `T`)
   * - optional fractional seconds `.s` to `.sss`
   * - optional trailing `Z` or `±HH:MM` offset
   *
   * Offset handling: a civil date-time carries no zone, so an explicit offset is
   * normalized away — the wall-clock time is converted to the equivalent civil time
   * in UTC and the offset is then discarded (`2020-01-01T00:00:00+02:00` parses as
   * civil `2019-12-31T22:00:00`). `Z` is a zero offset and changes nothing.
   *
   * Throws TypeMismatchError on any other input.
   */
  static parseISO(input: string): CivilDateTime {
    const m = ISO_RE.exec(input);
    if (m === null) {
      throw new TypeMismatchError(`Cannot parse ${JSON.stringify(input)} as an ISO-8601 date-time`);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = m[4] === undefined ? 0 : Number(m[4]);
    const minute = m[5] === undefined ? 0 : Number(m[5]);
    const second = m[6] === undefined ? 0 : Number(m[6]);
    const millisecond = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
    const civil = CivilDateTime.of(year, month, day, hour, minute, second, millisecond);
    const offset = m[8];
    if (offset === undefined || offset === "Z") {
      return civil;
    }
    const sign = offset.startsWith("-") ? -1 : 1;
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      throw new TypeMismatchError(
        `Invalid UTC offset ${JSON.stringify(offset)} in ${JSON.stringify(input)}`,
      );
    }
    // Normalize to the UTC-equivalent civil time: subtract the offset.
    return civil.shiftMinutes(-sign * (offsetHours * 60 + offsetMinutes));
  }

  /** Boundary conversion: builds a civil date-time from a JS Date's UTC fields. */
  static fromDate(d: Date): CivilDateTime {
    return CivilDateTime.of(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    );
  }

  /** Boundary conversion: the JS Date whose UTC fields equal this civil date-time. */
  toDate(): Date {
    const d = new Date(0);
    // Set fields instead of Date.UTC(): Date.UTC maps years 0-99 to 1900-1999.
    d.setUTCFullYear(this.year, this.month - 1, this.day);
    d.setUTCHours(this.hour, this.minute, this.second, this.millisecond);
    return d;
  }

  /** Adds `n` (integer, may be negative) calendar days; time of day is preserved. */
  addDays(n: number): CivilDateTime {
    requireInteger(n, "day count");
    const { year, month, day } = civilFromDays(this.epochDay() + n);
    return new CivilDateTime(
      year,
      month,
      day,
      this.hour,
      this.minute,
      this.second,
      this.millisecond,
    );
  }

  /**
   * Adds `n` (integer, may be negative) calendar months with Ruby `Date#>>`
   * semantics: the day-of-month is kept when the target month has it, otherwise
   * clamped to the target month's last day (2020-01-31 + 1 month = 2020-02-29;
   * 2019-01-31 + 1 month = 2019-02-28). Time of day is preserved.
   */
  addMonths(n: number): CivilDateTime {
    requireInteger(n, "month count");
    const total = this.year * 12 + (this.month - 1) + n;
    const year = Math.floor(total / 12);
    const month = total - year * 12 + 1;
    const day = Math.min(this.day, daysInMonth(year, month));
    return new CivilDateTime(
      year,
      month,
      day,
      this.hour,
      this.minute,
      this.second,
      this.millisecond,
    );
  }

  /** Adds `n` calendar years; equivalent to addMonths(12 * n), including clamping. */
  addYears(n: number): CivilDateTime {
    requireInteger(n, "year count");
    return this.addMonths(12 * n);
  }

  /**
   * `this − other` in days as a Decimal, fractional when the times of day differ
   * (Ruby DateTime subtraction parity: noon − midnight of the same day = 0.5).
   */
  diffDays(other: CivilDateTimeFields): Decimal {
    const o = CivilDateTime.from(other);
    const wholeDays = this.epochDay() - o.epochDay();
    const msDelta = this.msOfDay() - o.msOfDay();
    return new Decimal(wholeDays).plus(new Decimal(msDelta).div(MS_PER_DAY));
  }

  /** Chronological comparison: -1 | 0 | 1. */
  compare(other: CivilDateTimeFields): -1 | 0 | 1 {
    const o = CivilDateTime.from(other);
    const a = this.epochDay() * MS_PER_DAY + this.msOfDay();
    const b = o.epochDay() * MS_PER_DAY + o.msOfDay();
    if (a < b) {
      return -1;
    }
    return a > b ? 1 : 0;
  }

  equals(other: CivilDateTimeFields): boolean {
    return this.compare(other) === 0;
  }

  /**
   * ISO-8601 text: `YYYY-MM-DD` when the time is exactly midnight, otherwise
   * `YYYY-MM-DDTHH:MM:SS` with `.sss` appended when milliseconds are nonzero.
   */
  toISO(): string {
    const date = `${padYear(this.year)}-${pad(this.month, 2)}-${pad(this.day, 2)}`;
    if (this.msOfDay() === 0) {
      return date;
    }
    const time = `${pad(this.hour, 2)}:${pad(this.minute, 2)}:${pad(this.second, 2)}`;
    const frac = this.millisecond === 0 ? "" : `.${pad(this.millisecond, 3)}`;
    return `${date}T${time}${frac}`;
  }

  private epochDay(): number {
    return daysFromCivil(this.year, this.month, this.day);
  }

  private msOfDay(): number {
    return ((this.hour * 60 + this.minute) * 60 + this.second) * 1000 + this.millisecond;
  }

  private shiftMinutes(minutes: number): CivilDateTime {
    const totalMinutes = this.hour * 60 + this.minute + minutes;
    const dayShift = Math.floor(totalMinutes / 1440);
    const minuteOfDay = totalMinutes - dayShift * 1440;
    const { year, month, day } = civilFromDays(this.epochDay() + dayShift);
    return new CivilDateTime(
      year,
      month,
      day,
      Math.floor(minuteOfDay / 60),
      minuteOfDay % 60,
      this.second,
      this.millisecond,
    );
  }
}

/**
 * A calendar duration (`duration(n, unit)` in formula text). Implements (and is
 * assignable to) the fields-only `Duration` interface in `src/values.ts`.
 */
export class Duration implements DurationFields {
  readonly value: number;
  readonly unit: DurationUnit;

  constructor(value: number, unit: DurationUnit) {
    requireInteger(value, "duration value");
    this.value = value;
    this.unit = unit;
  }

  /**
   * Normalizes a unit word from formula text: `year(s)` / `month(s)` / `day(s)`,
   * case-insensitive. Throws TypeMismatchError on anything else.
   */
  static parseUnit(raw: string): DurationUnit {
    const m = /^(year|month|day)s?$/i.exec(raw.trim());
    if (m === null) {
      throw new TypeMismatchError(`Unknown duration unit ${JSON.stringify(raw)}`);
    }
    return (m[1] as string).toLowerCase() as DurationUnit;
  }

  negate(): Duration {
    return new Duration(-this.value, this.unit);
  }
}

/**
 * Applies a duration to a civil date-time. `sign` selects addition (1) or
 * subtraction (-1); month/year durations clamp per addMonths/addYears.
 */
export function applyDuration(
  base: CivilDateTimeFields,
  d: DurationFields,
  sign: 1 | -1,
): CivilDateTime {
  const civil = CivilDateTime.from(base);
  const n = sign * d.value;
  switch (d.unit) {
    case "year":
      return civil.addYears(n);
    case "month":
      return civil.addMonths(n);
    case "day":
      return civil.addDays(n);
    default:
      throw new TypeMismatchError(`Unknown duration unit ${JSON.stringify(d.unit)}`);
  }
}
