// Ported from Ruby dentaku v3.5.7: spec/tokenizer_spec.rb, spec/token_spec.rb,
// spec/token_scanner_spec.rb — plus the extra cases from docs/issues/005-tokenizer.md.
// Deviations from Ruby behavior are annotated with their ADR tightening.
import { describe, expect, it } from "vitest";
import { Decimal } from "../src/decimal.js";
import { ParseError } from "../src/errors.js";
import { buildScanners } from "../src/tokenizer/scanners.js";
import type { Token } from "../src/tokenizer/token.js";
import { tokenize } from "../src/tokenizer/tokenizer.js";

function categories(tokens: Token[]): string[] {
  return tokens.map((t) => t.category);
}

// Decimal values are unwrapped to numbers for readable comparisons.
function values(tokens: Token[]): unknown[] {
  return tokens.map((t) => (t.value instanceof Decimal ? t.value.toNumber() : t.value));
}

function parseErrorFrom(fn: () => unknown): ParseError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    return e as ParseError;
  }
  throw new Error("expected a ParseError to be thrown");
}

describe("tokenizer (spec/tokenizer_spec.rb)", () => {
  it("handles an empty expression", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles a whitespace-only expression", () => {
    expect(tokenize("   ")).toEqual([]);
  });

  it("tokenizes numeric literal in decimal", () => {
    const token = tokenize("80")[0] as Token;
    expect(token.category).toBe("numeric");
    expect(token.value).toBeInstanceOf(Decimal);
    expect((token.value as Decimal).toNumber()).toBe(80);
  });

  it("tokenizes numeric literal in hexadecimal", () => {
    const token = tokenize("0x80")[0] as Token;
    expect(token.category).toBe("numeric");
    expect((token.value as Decimal).toNumber()).toBe(128);
  });

  it("tokenizes hexadecimal in any letter case", () => {
    expect(values(tokenize("0xFF"))).toEqual([255]);
    expect(values(tokenize("0Xff"))).toEqual([255]);
  });

  it("tokenizes numeric literal in scientific notation", () => {
    for (const s of ["6.02e23", ".602E+24"]) {
      const tokens = tokenize(s);
      expect(categories(tokens)).toEqual(["numeric"]);
      expect(values(tokens)).toEqual([6.02e23]);
    }

    expect(values(tokenize("6E23"))).toEqual([0.6e24]);
    expect(values(tokenize("6e-23"))).toEqual([0.6e-22]);
  });

  it("keeps numeric literals exact as Decimal (ADR-0001)", () => {
    const token = tokenize("8.75")[0] as Token;
    expect(token.value).toBeInstanceOf(Decimal);
    expect((token.value as Decimal).equals(new Decimal("8.75"))).toBe(true);
  });

  it("tokenizes addition", () => {
    const tokens = tokenize("1+1");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([1, "add", 1]);
  });

  it("tokenizes unary minus", () => {
    let tokens = tokenize("-5");
    expect(categories(tokens)).toEqual(["operator", "numeric"]);
    expect(values(tokens)).toEqual(["negate", 5]);

    tokens = tokenize("(-5)");
    expect(categories(tokens)).toEqual(["grouping", "operator", "numeric", "grouping"]);
    expect(values(tokens)).toEqual(["open", "negate", 5, "close"]);

    tokens = tokenize("{-5, -2}[-1]");
    expect(categories(tokens)).toEqual([
      "array", // {
      "operator",
      "numeric",
      "grouping", // -5,
      "operator",
      "numeric",
      "array", // -2}
      "access",
      "operator",
      "numeric",
      "access", // [-1]
    ]);
    expect(values(tokens)).toEqual([
      "arrayStart", // {
      "negate",
      5,
      "comma", // -5,
      "negate",
      2,
      "arrayEnd", // -2}
      "lbracket",
      "negate",
      1,
      "rbracket", // [-1]
    ]);

    tokens = tokenize("if(-5 > x, -7, -8) - 9");
    expect(categories(tokens)).toEqual([
      "function",
      "grouping", // if(
      "operator",
      "numeric",
      "comparator",
      "identifier",
      "grouping", // -5 > x,
      "operator",
      "numeric",
      "grouping", // -7,
      "operator",
      "numeric",
      "grouping", // -8)
      "operator",
      "numeric", // - 9
    ]);
    expect(values(tokens)).toEqual([
      "if",
      "open", // if(
      "negate",
      5,
      "gt",
      "x",
      "comma", // -5 > x,
      "negate",
      7,
      "comma", // -7,
      "negate",
      8,
      "close", // -8)
      "subtract",
      9, // - 9
    ]);
  });

  it("tokenizes comparison with =", () => {
    const tokens = tokenize("number = 5");
    expect(categories(tokens)).toEqual(["identifier", "comparator", "numeric"]);
    expect(values(tokens)).toEqual(["number", "eq", 5]);
  });

  it("tokenizes comparison with alternate ==", () => {
    const tokens = tokenize("number == 5");
    expect(categories(tokens)).toEqual(["identifier", "comparator", "numeric"]);
    expect(values(tokens)).toEqual(["number", "eq", 5]);
  });

  it("tokenizes bitwise OR", () => {
    const tokens = tokenize("2 | 3");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([2, "bitor", 3]);
  });

  it("tokenizes bitwise AND", () => {
    const tokens = tokenize("2 & 3");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([2, "bitand", 3]);
  });

  // Ruby names these :bitshiftleft/:bitshiftright; the frozen Token contract
  // (docs/issues/005-tokenizer.md) names them shiftleft/shiftright.
  it("tokenizes bitwise SHIFT LEFT", () => {
    const tokens = tokenize("2 << 3");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([2, "shiftleft", 3]);
  });

  it("tokenizes bitwise SHIFT RIGHT", () => {
    const tokens = tokenize("2 >> 3");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([2, "shiftright", 3]);
  });

  it("ignores whitespace", () => {
    const tokens = tokenize("1     / 1     ");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([1, "divide", 1]);
  });

  it("tokenizes power operations in simple expressions", () => {
    const tokens = tokenize("10 ^ 2");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([10, "pow", 2]);
  });

  it("tokenizes power operations in complex expressions", () => {
    const tokens = tokenize("0 * 10 ^ -5");
    expect(categories(tokens)).toEqual([
      "numeric",
      "operator",
      "numeric",
      "operator",
      "operator",
      "numeric",
    ]);
    expect(values(tokens)).toEqual([0, "multiply", 10, "pow", "negate", 5]);
  });

  it("handles floating point operands", () => {
    const tokens = tokenize("1.5 * 3.7");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([1.5, "multiply", 3.7]);
  });

  it("does not require leading zero", () => {
    const tokens = tokenize(".5 * 3.7");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([0.5, "multiply", 3.7]);
  });

  it("accepts arbitrary identifiers", () => {
    const tokens = tokenize("sea_monkeys > 1500");
    expect(categories(tokens)).toEqual(["identifier", "comparator", "numeric"]);
    expect(values(tokens)).toEqual(["sea_monkeys", "gt", 1500]);
  });

  it("recognizes double-quoted strings", () => {
    const tokens = tokenize('animal = "giraffe"');
    expect(categories(tokens)).toEqual(["identifier", "comparator", "string"]);
    expect(values(tokens)).toEqual(["animal", "eq", "giraffe"]);
  });

  it("recognizes single-quoted strings", () => {
    const tokens = tokenize("animal = 'giraffe'");
    expect(categories(tokens)).toEqual(["identifier", "comparator", "string"]);
    expect(values(tokens)).toEqual(["animal", "eq", "giraffe"]);
  });

  it("recognizes binary minus operator", () => {
    const tokens = tokenize("2 - 3");
    expect(categories(tokens)).toEqual(["numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual([2, "subtract", 3]);
  });

  it("recognizes unary minus operator applied to left operand", () => {
    const tokens = tokenize("-2 + 3");
    expect(categories(tokens)).toEqual(["operator", "numeric", "operator", "numeric"]);
    expect(values(tokens)).toEqual(["negate", 2, "add", 3]);
  });

  it("recognizes unary minus operator applied to right operand", () => {
    const tokens = tokenize("2 - -3");
    expect(categories(tokens)).toEqual(["numeric", "operator", "operator", "numeric"]);
    expect(values(tokens)).toEqual([2, "subtract", "negate", 3]);
  });

  it('matches "<=" before "<"', () => {
    const tokens = tokenize("perimeter <= 7500");
    expect(categories(tokens)).toEqual(["identifier", "comparator", "numeric"]);
    expect(values(tokens)).toEqual(["perimeter", "le", 7500]);
  });

  it('tokenizes "and" for logical expressions', () => {
    const tokens = tokenize("octopi <= 7500 AND sharks > 1500");
    expect(categories(tokens)).toEqual([
      "identifier",
      "comparator",
      "numeric",
      "combinator",
      "identifier",
      "comparator",
      "numeric",
    ]);
    expect(values(tokens)).toEqual(["octopi", "le", 7500, "and", "sharks", "gt", 1500]);
  });

  it('tokenizes "or" for logical expressions', () => {
    const tokens = tokenize("size < 3 or admin = 1");
    expect(categories(tokens)).toEqual([
      "identifier",
      "comparator",
      "numeric",
      "combinator",
      "identifier",
      "comparator",
      "numeric",
    ]);
    expect(values(tokens)).toEqual(["size", "lt", 3, "or", "admin", "eq", 1]);
  });

  it('tokenizes "&&" for logical expressions', () => {
    const tokens = tokenize("octopi <= 7500 && sharks > 1500");
    expect(values(tokens)).toEqual(["octopi", "le", 7500, "and", "sharks", "gt", 1500]);
    expect(categories(tokens)[3]).toBe("combinator");
  });

  it('tokenizes "||" for logical expressions', () => {
    const tokens = tokenize("size < 3 || admin = 1");
    expect(values(tokens)).toEqual(["size", "lt", 3, "or", "admin", "eq", 1]);
    expect(categories(tokens)[3]).toBe("combinator");
  });

  // Faithful Ruby quirk: the combinator regex is (and|or|&&|\|\|)\s — even the
  // symbol forms need trailing whitespace, otherwise the operator scanner wins.
  it("tokenizes || without trailing whitespace as two bitor operators", () => {
    expect(values(tokenize("2||3"))).toEqual([2, "bitor", "bitor", 3]);
  });

  it("tokenizes curly brackets for array literals", () => {
    const tokens = tokenize("{}");
    expect(categories(tokens)).toEqual(["array", "array"]);
    expect(values(tokens)).toEqual(["arrayStart", "arrayEnd"]);
  });

  it("tokenizes square brackets for data structure access", () => {
    const tokens = tokenize("a[1]");
    expect(categories(tokens)).toEqual(["identifier", "access", "numeric", "access"]);
    expect(values(tokens)).toEqual(["a", "lbracket", 1, "rbracket"]);
  });

  it("detects unbalanced parentheses", () => {
    const opening = parseErrorFrom(() => tokenize("(5+3"));
    expect(opening.message).toMatch(/too many opening parentheses/);
    expect(opening.reason).toBe("unbalanced-parenthesis");
    expect(opening.position).toBe(0);

    const closing = parseErrorFrom(() => tokenize(")"));
    expect(closing.message).toMatch(/too many closing parentheses/);
    expect(closing.reason).toBe("unbalanced-parenthesis");
    expect(closing.position).toBe(0);
  });

  // Tokenizer-level bracket/brace balance is a dentaku-ts spec extension
  // (docs/issues/005-tokenizer.md); Ruby defers these to the parser.
  it("detects unbalanced square brackets", () => {
    expect(parseErrorFrom(() => tokenize("a[1")).reason).toBe("unbalanced-bracket");
    expect(parseErrorFrom(() => tokenize("a 1]")).reason).toBe("unbalanced-bracket");
  });

  it("detects unbalanced curly braces", () => {
    expect(parseErrorFrom(() => tokenize("{1, 2")).reason).toBe("unbalanced-brace");
    expect(parseErrorFrom(() => tokenize("1, 2}")).reason).toBe("unbalanced-brace");
  });

  it("raises invalid-token with position for unmatched input", () => {
    const err = parseErrorFrom(() => tokenize("a $ b"));
    expect(err.reason).toBe("invalid-token");
    expect(err.position).toBe(2);
    expect(err.message).toMatch(/parse error at: '\$ b'/);
  });

  it("recognizes identifiers that share initial substrings with combinators", () => {
    const tokens = tokenize("andover < 10");
    expect(tokens).toHaveLength(3);
    expect(categories(tokens)).toEqual(["identifier", "comparator", "numeric"]);
    expect(values(tokens)).toEqual(["andover", "lt", 10]);
  });

  it("tokenizes TRUE and FALSE literals", () => {
    let tokens = tokenize("true and false");
    expect(tokens).toHaveLength(3);
    expect(categories(tokens)).toEqual(["logical", "combinator", "logical"]);
    expect(values(tokens)).toEqual([true, "and", false]);

    tokens = tokenize("true_lies and falsehoods");
    expect(tokens).toHaveLength(3);
    expect(categories(tokens)).toEqual(["identifier", "combinator", "identifier"]);
    expect(values(tokens)).toEqual(["true_lies", "and", "falsehoods"]);
  });

  it("tokenizes the null literal in any case", () => {
    for (const formula of ["null", "NULL", "Null"]) {
      const tokens = tokenize(formula);
      expect(categories(tokens)).toEqual(["null"]);
      expect(values(tokens)).toEqual([null]);
    }
  });

  it("tokenizes CASE keywords in any case", () => {
    const tokens = tokenize("CASE x WHEN 1 THEN 2 ELSE 3 END");
    expect(categories(tokens)).toEqual([
      "case",
      "identifier",
      "case",
      "numeric",
      "case",
      "numeric",
      "case",
      "numeric",
      "case",
    ]);
    // Contract naming: the keywords themselves (Ruby maps case→:open, end→:close).
    expect(values(tokens)).toEqual(["case", "x", "when", 1, "then", 2, "else", 3, "end"]);
  });

  it("tokenizes backtick-quoted identifiers verbatim", () => {
    const tokens = tokenize("`Total Cost` + 1");
    expect(categories(tokens)).toEqual(["identifier", "operator", "numeric"]);
    expect(values(tokens)).toEqual(["Total Cost", "add", 1]);
  });

  // ADR-0003.5: bare date literals are off by default (Ruby's raw_date_literals
  // defaulted to true), so these run with { dateLiterals: true }.
  it("tokenizes Time literals", () => {
    const tokens = tokenize(
      "2017-01-01 2017-01-2 2017-1-03 2017-01-04 12:23:42 2017-1-5 1:2:3 2017-1-06 1:02:30 2017-01-07 12:34:56 Z 2017-01-08 1:2:3 +0800 2017-01-08T01:02:03.456Z",
      { dateLiterals: true },
    );
    expect(tokens).toHaveLength(9);
    expect(categories(tokens)).toEqual(Array(9).fill("datetime"));
    expect(values(tokens)).toEqual([
      { year: 2017, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
      { year: 2017, month: 1, day: 2, hour: 0, minute: 0, second: 0, millisecond: 0 },
      { year: 2017, month: 1, day: 3, hour: 0, minute: 0, second: 0, millisecond: 0 },
      { year: 2017, month: 1, day: 4, hour: 12, minute: 23, second: 42, millisecond: 0 },
      { year: 2017, month: 1, day: 5, hour: 1, minute: 2, second: 3, millisecond: 0 },
      { year: 2017, month: 1, day: 6, hour: 1, minute: 2, second: 30, millisecond: 0 },
      { year: 2017, month: 1, day: 7, hour: 12, minute: 34, second: 56, millisecond: 0 },
      // ADR-0004: Ruby keeps the +08:00 offset on the DateTime; the civil type
      // normalizes to the equivalent UTC civil time and discards the offset
      // (same instant as Ruby's Time.new(2017, 1, 8, 1, 2, 3, "+08:00")).
      { year: 2017, month: 1, day: 7, hour: 17, minute: 2, second: 3, millisecond: 0 },
      { year: 2017, month: 1, day: 8, hour: 1, minute: 2, second: 3, millisecond: 456 },
    ]);
  });

  it("tokenizes datetime literals inside expressions when enabled", () => {
    const tokens = tokenize("created_at > 2017-01-01", { dateLiterals: true }); // ADR-0003.5
    expect(categories(tokens)).toEqual(["identifier", "comparator", "datetime"]);
  });

  describe("tokenizing function calls", () => {
    it("handles IF", () => {
      const tokens = tokenize("if(x < 10, y, z)");
      expect(tokens).toHaveLength(10);
      expect(categories(tokens)).toEqual([
        "function",
        "grouping",
        "identifier",
        "comparator",
        "numeric",
        "grouping",
        "identifier",
        "grouping",
        "identifier",
        "grouping",
      ]);
      expect(values(tokens)).toEqual([
        "if",
        "open",
        "x",
        "lt",
        10,
        "comma",
        "y",
        "comma",
        "z",
        "close",
      ]);
    });

    it("handles ROUND/UP/DOWN", () => {
      let tokens = tokenize("round(8.2)");
      expect(tokens).toHaveLength(4);
      expect(categories(tokens)).toEqual(["function", "grouping", "numeric", "grouping"]);
      expect(values(tokens)).toEqual(["round", "open", 8.2, "close"]);

      tokens = tokenize("round(8.75, 1)");
      expect(tokens).toHaveLength(6);
      expect(categories(tokens)).toEqual([
        "function",
        "grouping",
        "numeric",
        "grouping",
        "numeric",
        "grouping",
      ]);
      expect(values(tokens)).toEqual(["round", "open", 8.75, "comma", 1, "close"]);

      tokens = tokenize("ROUNDUP(8.2)");
      expect(tokens).toHaveLength(4);
      expect(categories(tokens)).toEqual(["function", "grouping", "numeric", "grouping"]);
      expect(values(tokens)).toEqual(["roundup", "open", 8.2, "close"]);

      tokens = tokenize("RoundDown(8.2)");
      expect(tokens).toHaveLength(4);
      expect(categories(tokens)).toEqual(["function", "grouping", "numeric", "grouping"]);
      expect(values(tokens)).toEqual(["rounddown", "open", 8.2, "close"]);
    });

    it("handles NOT", () => {
      const tokens = tokenize("not(8 < 5)");
      expect(tokens).toHaveLength(6);
      expect(categories(tokens)).toEqual([
        "function",
        "grouping",
        "numeric",
        "comparator",
        "numeric",
        "grouping",
      ]);
      expect(values(tokens)).toEqual(["not", "open", 8, "lt", 5, "close"]);
    });

    it("handles ANY/ALL", () => {
      for (const fn of ["any", "all"]) {
        const tokens = tokenize(`${fn}(users, u, u.age > 18)`);
        expect(tokens).toHaveLength(10);
        expect(
          tokens.map((t) => [
            t.category,
            t.value instanceof Decimal ? t.value.toNumber() : t.value,
          ]),
        ).toEqual([
          ["function", fn], // function call (any/all)
          ["grouping", "open"], // (
          ["identifier", "users"], // users
          ["grouping", "comma"], // ,
          ["identifier", "u"], // u
          ["grouping", "comma"], // ,
          ["identifier", "u.age"], // u.age
          ["comparator", "gt"], // >
          ["numeric", 18], // 18
          ["grouping", "close"], // )
        ]);
      }
    });

    it("handles whitespace after function name", () => {
      const tokens = tokenize("not (8 < 5)");
      expect(tokens).toHaveLength(6);
      expect(categories(tokens)).toEqual([
        "function",
        "grouping",
        "numeric",
        "comparator",
        "numeric",
        "grouping",
      ]);
      expect(values(tokens)).toEqual(["not", "open", 8, "lt", 5, "close"]);
    });

    it("handles when function ends with a bang", () => {
      const tokens = tokenize("exp!(5 * 3)");
      expect(tokens).toHaveLength(6);
      expect(categories(tokens)).toEqual([
        "function",
        "grouping",
        "numeric",
        "operator",
        "numeric",
        "grouping",
      ]);
      expect(values(tokens)).toEqual(["exp!", "open", 5, "multiply", 3, "close"]);
    });

    it("downcases function names regardless of identifier options", () => {
      // Function-name matching is always case-insensitive (ADR-0003.1 keeps this).
      expect(values(tokenize("ROUND(1)"))).toEqual(["round", "open", 1, "close"]);
      expect(values(tokenize("ROUND(1)", { caseInsensitiveIdentifiers: false }))).toEqual([
        "round",
        "open",
        1,
        "close",
      ]);
    });
  });

  // Ruby's `describe 'aliases'` block is not ported: global function aliases are
  // a removed host-level feature (PLAN.md "Removals"; i18n aliases are 1.x backlog).

  describe("identifier case (ADR-0003.1)", () => {
    it("preserves identifier case by default", () => {
      // ADR-0003.1: Ruby downcased identifiers by default; dentaku-ts preserves case.
      expect(values(tokenize("MyVar + Other_VAR"))).toEqual(["MyVar", "add", "Other_VAR"]);
    });

    it("downcases identifiers under caseInsensitiveIdentifiers", () => {
      // ADR-0003.1: option restores Ruby behavior.
      expect(values(tokenize("MyVar + Other_VAR", { caseInsensitiveIdentifiers: true }))).toEqual([
        "myvar",
        "add",
        "other_var",
      ]);
    });

    it("keeps backtick-quoted identifiers verbatim even when case-insensitive", () => {
      // Faithful to Ruby: quoted_identifier never applies standardize_case.
      expect(values(tokenize("`My Var`", { caseInsensitiveIdentifiers: true }))).toEqual([
        "My Var",
      ]);
    });
  });

  describe("comments", () => {
    it("strips single-line comments", () => {
      expect(values(tokenize("/* comment */ 1 + 1"))).toEqual([1, "add", 1]);
    });

    it("strips multi-line and multiple comments", () => {
      expect(values(tokenize("1 /* a\nmulti-line\ncomment */ + /* another */ 1"))).toEqual([
        1,
        "add",
        1,
      ]);
    });

    it("joins text around a comment without inserting whitespace (faithful Ruby quirk)", () => {
      // Ruby gsubs comments away before scanning, so '1/*c*/2' scans as '12'.
      const tokens = tokenize("1/*c*/2");
      expect(categories(tokens)).toEqual(["numeric"]);
      expect(values(tokens)).toEqual([12]);
    });
  });

  describe("token positions", () => {
    it("reports offsets into the input", () => {
      expect(tokenize("1 + 2").map((t) => t.position)).toEqual([0, 2, 4]);
    });

    it("reports offsets into the ORIGINAL input when comments are stripped", () => {
      const formula = "1 /* note */+ 2";
      const tokens = tokenize(formula);
      expect(tokens.map((t) => t.position)).toEqual([0, 12, 14]);
      expect(formula[12]).toBe("+");
      expect(formula[14]).toBe("2");
    });

    it("positions the open paren emitted by the function scanner after the name", () => {
      const tokens = tokenize("not (8 < 5)");
      expect((tokens[0] as Token).raw).toBe("not ");
      expect((tokens[0] as Token).position).toBe(0);
      expect((tokens[1] as Token).raw).toBe("(");
      expect((tokens[1] as Token).position).toBe(4);
    });

    it("includes trailing whitespace in a combinator token's raw text", () => {
      const tokens = tokenize("a and b");
      expect((tokens[1] as Token).raw).toBe("and ");
      expect((tokens[1] as Token).position).toBe(2);
      expect((tokens[2] as Token).position).toBe(6);
    });
  });

  describe("extra cases (docs/issues/005-tokenizer.md)", () => {
    it("tokenizes trailing % as mod (percentage resolution is the parser's job)", () => {
      expect(values(tokenize("5%"))).toEqual([5, "mod"]);
      expect(categories(tokenize("5%"))).toEqual(["numeric", "operator"]);
    });

    it("tokenizes infix % as mod", () => {
      expect(values(tokenize("5 % 2"))).toEqual([5, "mod", 2]);
    });

    it("tokenizes 2020-1-1 as arithmetic without the dateLiterals flag", () => {
      // ADR-0003.5: bare date literals are off by default.
      const tokens = tokenize("2020-1-1");
      expect(categories(tokens)).toEqual(["numeric", "operator", "numeric", "operator", "numeric"]);
      expect(values(tokens)).toEqual([2020, "subtract", 1, "subtract", 1]);
    });

    it("tokenizes 2020-1-1 as a datetime with the dateLiterals flag", () => {
      const tokens = tokenize("2020-1-1", { dateLiterals: true }); // ADR-0003.5
      expect(categories(tokens)).toEqual(["datetime"]);
      expect(values(tokens)).toEqual([
        { year: 2020, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 },
      ]);
    });

    it("keeps dash-less numbers numeric even with the dateLiterals flag", () => {
      expect(values(tokenize("2020-11", { dateLiterals: true }))).toEqual([2020, "subtract", 11]);
    });

    it("tokenizes a.b.c as one identifier token", () => {
      const tokens = tokenize("a.b.c");
      expect(tokens).toHaveLength(1);
      expect(categories(tokens)).toEqual(["identifier"]);
      expect(values(tokens)).toEqual(["a.b.c"]);
    });

    it("scopes the negate lookbehind by category, not just value", () => {
      // A string literal whose value happens to be 'open' must not enable negate.
      expect(values(tokenize("'open' - 5"))).toEqual(["open", "subtract", 5]);
    });
  });
});

describe("token (spec/token_spec.rb)", () => {
  it("has a category, a value, a raw text, and a position", () => {
    const token = tokenize("5")[0] as Token;
    expect(token.category).toBe("numeric");
    expect((token.value as Decimal).toNumber()).toBe(5);
    expect(token.raw).toBe("5");
    expect(token.position).toBe(0);
  });

  // Ruby's Token#== wildcard-equality example is not ported: tokens here are
  // plain data (frozen contract); matching logic belongs to the parser (006).
});

describe("token scanners (spec/token_scanner_spec.rb)", () => {
  // Ruby's registry-mutation examples (scanners=, register_scanner, custom
  // scanners) exercise the global mutable scanner registry, a removed
  // host-level feature (PLAN.md "Removals"). Only match/convert behavior ports.
  const scanners = buildScanners({});

  function firstMatch(input: string) {
    for (const scanner of scanners) {
      const result = scanner(input, 0, null);
      if (result !== null) {
        return result;
      }
    }
    return null;
  }

  it("returns a token for a matching string", () => {
    const result = firstMatch("5");
    expect(result).not.toBeNull();
    expect(result?.tokens[0]?.category).toBe("numeric");
  });

  it("returns null for a non-matching string", () => {
    expect(firstMatch("#")).toBeNull();
  });

  it("performs raw value conversion", () => {
    const token = firstMatch("5")?.tokens[0] as Token;
    expect(token.value).toBeInstanceOf(Decimal);
    expect((token.value as Decimal).toNumber()).toBe(5);
  });
});
