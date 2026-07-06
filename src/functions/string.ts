// String function pack: left, right, mid, len, find, substitute, concat,
// contains. Ported from Ruby dentaku v3.5.7
// lib/dentaku/ast/functions/string_functions.rb (issue 008).
//
// Semantics notes:
// - Arguments stringify via Ruby `to_s` parity: strings pass through, booleans
//   render "true"/"false", null renders "" (nil.to_s). Numbers render via
//   Decimal#toString — a deliberate improvement over Ruby's BigDecimal#to_s
//   scientific notation (`0.25e1`), per ADR-0001 (decimal.js is the numeric
//   backbone) and the issue 008 spec.
// - All character positions and lengths are Unicode code points (`[...s]`),
//   never UTF-16 units: Ruby strings are character-based, so this is the
//   parity choice (`LEN("💀💀") = 2`).
// - Length/offset arguments accept numerics or numeric-looking strings
//   (Ruby `Function.numeric` parity: /\A-?\d*\.?\d+\z/), truncate toward zero
//   (Ruby `.to_i`), and must be non-negative after truncation, else
//   TypeMismatchError with Ruby's message wording.
import { CivilDateTime } from "../civil-date.js";
import { Decimal } from "../decimal.js";
import { TypeMismatchError } from "../errors.js";
import { isCivilDateTime, isDuration, type Value } from "../values.js";
import type { FunctionDef } from "./types.js";

/**
 * Converts any Value to its display string (Ruby `to_s` parity; see module
 * comment). Total: composite values render recursively, date-times as ISO
 * text, durations as "value unit".
 */
function display(v: Value): string {
  if (v === null) {
    return "";
  }
  switch (typeof v) {
    case "string":
      return v;
    case "boolean":
      return v ? "true" : "false";
    default:
      break;
  }
  if (v instanceof Decimal) {
    return v.toString();
  }
  if (Array.isArray(v)) {
    return `[${v.map(display).join(", ")}]`;
  }
  if (isDuration(v)) {
    return `${v.value} ${v.unit}`;
  }
  if (isCivilDateTime(v)) {
    return CivilDateTime.from(v).toISO();
  }
  return `{${Object.entries(v)
    .map(([k, item]) => `${k}: ${display(item)}`)
    .join(", ")}}`;
}

/** The string as an array of code points (character semantics, not UTF-16). */
function codePoints(v: Value): string[] {
  return [...display(v)];
}

// Ruby Function.numeric accepts plain integers/decimals only: /\A-?\d*\.?\d+\z/
// (no exponent, no thousands separators).
const NUMERIC_STRING = /^-?\d*\.?\d+$/;

/** Ruby `Dentaku::AST::Function.numeric` parity for length/offset arguments. */
function coerceNumeric(v: Value): Decimal {
  if (v instanceof Decimal) {
    return v;
  }
  if (typeof v === "string" && NUMERIC_STRING.test(v)) {
    return new Decimal(v);
  }
  // Ruby renders the offending value into the message ("'junk' is not
  // coercible to numeric"). For non-strings we use a JS-side spelling
  // ("null", "true") rather than Ruby's class-name leakage ("NilClass").
  const shown = typeof v === "string" ? v : v === null ? "null" : display(v);
  throw new TypeMismatchError(`'${shown}' is not coercible to numeric`);
}

/**
 * Coerces a length/offset argument: numeric coercion, truncation toward zero
 * (Ruby `.to_i`, so `-0.5` becomes 0 and passes), then the non-negative check
 * with Ruby's message wording ("LEFT() requires length to be positive").
 */
function requireCount(fun: string, arg: "length" | "offset", v: Value): number {
  const n = coerceNumeric(v).trunc().toNumber();
  if (n < 0) {
    throw new TypeMismatchError(`${fun}() requires ${arg} to be positive`);
  }
  return n;
}

export const stringFunctions: FunctionDef[] = [
  {
    name: "left",
    returnType: "string",
    minArgs: 2,
    maxArgs: 2,
    fn: (string: Value, length: Value): Value => {
      const s = codePoints(string);
      const n = requireCount("LEFT", "length", length);
      return s.slice(0, n).join("");
    },
  },
  {
    name: "right",
    returnType: "string",
    minArgs: 2,
    maxArgs: 2,
    fn: (string: Value, length: Value): Value => {
      const s = codePoints(string);
      const n = requireCount("RIGHT", "length", length);
      // Ruby: `string[-length, length] || string` — an over-long length
      // clamps to the whole string.
      return n >= s.length ? s.join("") : s.slice(s.length - n).join("");
    },
  },
  {
    name: "mid",
    returnType: "string",
    minArgs: 3,
    maxArgs: 3,
    fn: (string: Value, offset: Value, length: Value): Value => {
      const s = codePoints(string);
      const off = requireCount("MID", "offset", offset);
      const n = requireCount("MID", "length", length);
      // Ruby indexes with `string[offset - 1, length]`, so offset is 1-based
      // and offset 0 wraps to the LAST character (Ruby negative-index
      // semantics; verified against dentaku v3.5.7: MID("abcdefg", 0, 4)
      // = "g"). Offsets past the end clamp to "".
      let start = off - 1;
      if (start < 0) {
        start += s.length;
      }
      if (start < 0) {
        return "";
      }
      return s.slice(start, start + n).join("");
    },
  },
  {
    name: "len",
    returnType: "numeric",
    minArgs: 1,
    maxArgs: 1,
    fn: (string: Value): Value => new Decimal(codePoints(string).length),
  },
  {
    name: "find",
    returnType: "numeric",
    minArgs: 2,
    maxArgs: 2,
    fn: (needle: Value, haystack: Value): Value => {
      const n = display(needle);
      const h = display(haystack);
      const idx = h.indexOf(n);
      if (idx === -1) {
        return null;
      }
      // 1-based position in code points: recount the UTF-16 prefix.
      return new Decimal([...h.slice(0, idx)].length + 1);
    },
  },
  {
    name: "substitute",
    returnType: "string",
    minArgs: 3,
    maxArgs: 3,
    fn: (original: Value, search: Value, replacement: Value): Value => {
      const o = display(original);
      const s = display(search);
      const r = display(replacement);
      // Ruby String#sub: FIRST occurrence only; an empty search matches at
      // position 0 (prepends the replacement). Manual splice avoids JS
      // String#replace's `$&`-pattern interpolation in the replacement.
      const idx = o.indexOf(s);
      if (idx === -1) {
        return o;
      }
      return o.slice(0, idx) + r + o.slice(idx + s.length);
    },
  },
  {
    name: "concat",
    returnType: "string",
    minArgs: 1,
    maxArgs: "variadic",
    fn: (...args: Value[]): Value => args.map(display).join(""),
  },
  {
    name: "contains",
    returnType: "logical",
    minArgs: 2,
    maxArgs: 2,
    fn: (needle: Value, haystack: Value): Value => display(haystack).includes(display(needle)),
  },
];
