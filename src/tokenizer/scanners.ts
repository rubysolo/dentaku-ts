// Ordered scanner table, ported from Ruby dentaku's token_scanner.rb.
// The order is semantically load-bearing (first match wins) — preserve it exactly:
// null, whitespace, [datetime], numeric, hexadecimal, double-quoted string,
// single-quoted string, negate, combinator, operator, grouping, array, access,
// case, comparator, boolean, function, identifier, quoted identifier.
//
// Every scanner matches its keywords case-insensitively (Ruby wraps all scanner
// regexes in %r{\A(...)}i); identifier *case* handling is a separate concern
// (see the identifier scanner, ADR-0003.1).
import { type CivilDateTime, civilDateTimeFromDate } from "../values.js";
import { parseHexLiteral, parseNumericLiteral } from "./numeric.js";
import type {
  AccessValue,
  ArrayValue,
  CaseValue,
  CombinatorValue,
  ComparatorValue,
  GroupingValue,
  OperatorValue,
  Token,
  TokenCategory,
  TokenValue,
} from "./token.js";

export interface TokenizerOptions {
  /** Enable bare datetime literals (Ruby default; off by default per ADR-0003.5). */
  dateLiterals?: boolean;
  /** Downcase identifiers, restoring Ruby behavior (off by default per ADR-0003.1). */
  caseInsensitiveIdentifiers?: boolean;
}

/** The outcome of one scanner match: emitted tokens plus total input consumed. */
export interface ScanResult {
  tokens: Token[];
  /** Characters consumed from the input (>= sum of token raw lengths; whitespace emits no token). */
  length: number;
}

/**
 * A scanner attempts a match at `pos` in `input` (the comment-stripped formula).
 * Token positions are set relative to `input`; the tokenizer remaps them to the
 * original formula afterwards.
 */
export type Scanner = (input: string, pos: number, lastToken: Token | null) => ScanResult | null;

function match(re: RegExp, input: string, pos: number): string | null {
  re.lastIndex = pos;
  const m = re.exec(input);
  return m === null ? null : m[0];
}

function singleToken(
  re: RegExp,
  category: TokenCategory,
  toValue: (raw: string) => TokenValue,
  condition?: (lastToken: Token | null) => boolean,
): Scanner {
  return (input, pos, lastToken) => {
    if (condition !== undefined && !condition(lastToken)) {
      return null;
    }
    const raw = match(re, input, pos);
    if (raw === null) {
      return null;
    }
    return {
      tokens: [{ category, value: toValue(raw), raw, position: pos }],
      length: raw.length,
    };
  };
}

// Ruby: /\d{2}\d{2}?-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{1,2}:\d{1,2}(\.\d*)?)? ?(Z|((\+|\-)\d{2}:?\d{2}))?(?!\d)/
const DATETIME_SCAN_SOURCE =
  "\\d{2}\\d{2}?-\\d{1,2}-\\d{1,2}([ T]\\d{1,2}:\\d{1,2}:\\d{1,2}(\\.\\d*)?)? ?(Z|((\\+|\\-)\\d{2}:?\\d{2}))?(?!\\d)";

const DATETIME_FIELDS =
  /^(?<year>\d{2}(?:\d{2})?)-(?<month>\d{1,2})-(?<day>\d{1,2})(?:[ T](?<hour>\d{1,2}):(?<minute>\d{1,2}):(?<second>\d{1,2})(?:\.(?<fraction>\d*))?)? ?(?<offset>Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parses the text matched by the datetime scanner into a plain CivilDateTime
 * object. Per issue 004's `CivilDateTime.parseISO` contract (ADR-0004): an
 * explicit UTC offset is normalized to the equivalent civil time in UTC and
 * then discarded; without an offset the fields are taken verbatim.
 * (Issue 006 swaps in the CivilDateTime class from issue 004.)
 */
export function parseDateTimeLiteral(raw: string): CivilDateTime {
  const m = DATETIME_FIELDS.exec(raw.trim());
  if (m === null || m.groups === undefined) {
    throw new Error(`datetime scanner matched unparseable text: ${JSON.stringify(raw)}`);
  }
  const g = m.groups;
  const year = Number(g.year);
  const month = Number(g.month);
  const day = Number(g.day);
  const hour = g.hour === undefined ? 0 : Number(g.hour);
  const minute = g.minute === undefined ? 0 : Number(g.minute);
  const second = g.second === undefined ? 0 : Number(g.second);
  const millisecond = g.fraction === undefined ? 0 : Number(g.fraction.padEnd(3, "0").slice(0, 3));
  const offset = g.offset;
  if (offset !== undefined && offset.toUpperCase() !== "Z") {
    const sign = offset.startsWith("-") ? -1 : 1;
    const digits = offset.slice(1).replace(":", "");
    const offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    // Normalize to the equivalent civil time in UTC, then discard the offset.
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    d.setUTCHours(hour, minute, second, millisecond);
    return civilDateTimeFromDate(new Date(d.getTime() - offsetMinutes * 60_000));
  }
  return { year, month, day, hour, minute, second, millisecond };
}

const OPERATOR_VALUES: Readonly<Record<string, OperatorValue>> = {
  "^": "pow",
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "/": "divide",
  "%": "mod",
  "|": "bitor",
  "&": "bitand",
  "<<": "shiftleft",
  ">>": "shiftright",
};

const GROUPING_VALUES: Readonly<Record<string, GroupingValue>> = {
  "(": "open",
  ")": "close",
  ",": "comma",
};

const ARRAY_VALUES: Readonly<Record<string, ArrayValue>> = {
  "{": "arrayStart",
  "}": "arrayEnd",
};

const ACCESS_VALUES: Readonly<Record<string, AccessValue>> = {
  "[": "lbracket",
  "]": "rbracket",
};

const COMPARATOR_VALUES: Readonly<Record<string, ComparatorValue>> = {
  "<=": "le",
  ">=": "ge",
  "!=": "ne",
  "<>": "ne",
  "<": "lt",
  ">": "gt",
  "==": "eq",
  "=": "eq",
};

function keyword<T extends TokenValue>(table: Readonly<Record<string, T>>): (raw: string) => T {
  return (raw) => {
    const value = table[raw.toLowerCase()];
    if (value === undefined) {
      throw new Error(`scanner matched unknown keyword: ${JSON.stringify(raw)}`);
    }
    return value;
  };
}

// Unary-minus lookbehind rule (Ruby token_scanner.rb `negate`): the previous
// meaningful token is nil, an operator, a comparator, a combinator, an open
// grouping, a comma, an lbracket, or an arrayStart. Value checks are scoped to
// the owning category so a *string literal* like 'open' cannot enable negate
// (Ruby distinguishes symbols from strings; TS needs the category guard).
function negateCondition(lastToken: Token | null): boolean {
  if (lastToken === null) {
    return true;
  }
  switch (lastToken.category) {
    case "operator":
    case "comparator":
    case "combinator":
      return true;
    case "grouping":
      return lastToken.value === "open" || lastToken.value === "comma";
    case "access":
      return lastToken.value === "lbracket";
    case "array":
      return lastToken.value === "arrayStart";
    default:
      return false;
  }
}

/**
 * Builds the scanner table for one tokenize call, in Ruby's order.
 * The datetime scanner is only present when `dateLiterals` is true (ADR-0003.5;
 * Ruby's `raw_date_literals` defaulted to true).
 */
export function buildScanners(options: TokenizerOptions): Scanner[] {
  const scanners: Scanner[] = [];

  scanners.push(singleToken(/null\b/iy, "null", () => null));

  // Whitespace is consumed but never emitted (Ruby drops :whitespace tokens).
  const whitespace: Scanner = (input, pos) => {
    const raw = match(/\s+/y, input, pos);
    return raw === null ? null : { tokens: [], length: raw.length };
  };
  scanners.push(whitespace);

  if (options.dateLiterals === true) {
    scanners.push(
      singleToken(new RegExp(DATETIME_SCAN_SOURCE, "iy"), "datetime", parseDateTimeLiteral),
    );
  }

  scanners.push(
    singleToken(/(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?\b/y, "numeric", parseNumericLiteral),
  );

  scanners.push(singleToken(/0x[0-9a-f]+\b/iy, "numeric", parseHexLiteral));

  // Strings have no escape sequences: a quote character cannot appear inside a
  // same-quoted string.
  scanners.push(singleToken(/"[^"]*"/y, "string", (raw) => raw.slice(1, -1)));
  scanners.push(singleToken(/'[^']*'/y, "string", (raw) => raw.slice(1, -1)));

  scanners.push(singleToken(/-/y, "operator", () => "negate", negateCondition));

  // Word forms (and both symbol forms, faithfully to Ruby) require trailing
  // whitespace, which is consumed as part of the token's raw text.
  scanners.push(
    singleToken(/(?:and|or|&&|\|\|)\s/iy, "combinator", (raw): CombinatorValue => {
      const norm = raw.trim().toLowerCase();
      if (norm === "&&" || norm === "and") {
        return "and";
      }
      return "or";
    }),
  );

  scanners.push(singleToken(/\^|\+|-|\*|\/|%|\||&|<<|>>/y, "operator", keyword(OPERATOR_VALUES)));

  scanners.push(singleToken(/[(),]/y, "grouping", keyword(GROUPING_VALUES)));

  // Ruby's array scanner also lists ',' but the grouping scanner always wins it.
  scanners.push(singleToken(/[{}]/y, "array", keyword(ARRAY_VALUES)));

  scanners.push(singleToken(/[[\]]/y, "access", keyword(ACCESS_VALUES)));

  scanners.push(
    singleToken(/(?:case|end|then|when|else)\b/iy, "case", (raw) => raw.toLowerCase() as CaseValue),
  );

  scanners.push(singleToken(/<=|>=|!=|<>|<|>|==|=/y, "comparator", keyword(COMPARATOR_VALUES)));

  scanners.push(
    singleToken(/(?:true|false)\b/iy, "logical", (raw) => raw.toLowerCase() === "true"),
  );

  // Emits TWO tokens: the function name (downcased — function matching is always
  // case-insensitive) and the opening grouping paren. Trailing '!' is allowed in
  // function names (Ruby: '\w+!?\s*\(').
  const functionScanner: Scanner = (input, pos) => {
    const raw = match(/\w+!?\s*\(/iy, input, pos);
    if (raw === null) {
      return null;
    }
    const nameRaw = raw.slice(0, -1); // everything but the '(' (may include trailing whitespace)
    return {
      tokens: [
        {
          category: "function",
          value: nameRaw.trimEnd().toLowerCase(),
          raw: nameRaw,
          position: pos,
        },
        { category: "grouping", value: "open", raw: "(", position: pos + nameRaw.length },
      ],
      length: raw.length,
    };
  };
  scanners.push(functionScanner);

  // ADR-0003.1: identifier case is preserved by default; Ruby downcased unless
  // case_sensitive. The caseInsensitiveIdentifiers option restores Ruby behavior.
  // Unicode-aware like Ruby's [[[:word:]]\.]+ (POSIX word class matches ρ etc.);
  // JS \b is ASCII-only so the redundant boundary is dropped — the greedy class
  // already ends at the first non-word character.
  const downcase = options.caseInsensitiveIdentifiers === true;
  scanners.push(
    singleToken(/[\p{L}\p{M}\p{Nd}\p{Pc}.]+/uy, "identifier", (raw) =>
      downcase ? raw.toLowerCase() : raw,
    ),
  );

  // Backtick-quoted identifiers keep their case verbatim even under
  // caseInsensitiveIdentifiers (faithful to Ruby's quoted_identifier scanner).
  scanners.push(singleToken(/`[^`]*`/y, "identifier", (raw) => raw.slice(1, -1)));

  return scanners;
}
