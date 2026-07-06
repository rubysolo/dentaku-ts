// Printer unit tests (issue 013): port of Ruby dentaku's
// spec/print_visitor_spec.rb (v3.5.7), including the precedence-
// parenthesization regression fixed in Ruby 3.5.2 (`10 - (0 - 10)`) and the
// percentage regression fixed in Ruby 3.5.5 (`3 * 4% * 0.001`), plus
// dentaku-ts-specific cases (backtick identifiers, arrays, unprintable
// literals).
import { describe, expect, it } from "vitest";
import { ArrayNode } from "../src/ast/array.js";
import { IdentifierNode } from "../src/ast/identifier.js";
import { StringNode } from "../src/ast/literal.js";
import { FunctionSet } from "../src/functions/registry.js";
import type { FunctionDef, ReturnType } from "../src/functions/types.js";
import { parseFormula } from "../src/parser/parser.js";
import { print } from "../src/printer.js";

// Minimal throwing stubs — the printer never evaluates, it only needs the
// parser to resolve names and arities (the real packs land in issues 007-010).
function stub(
  name: string,
  returnType: ReturnType,
  minArgs: number,
  maxArgs: number | "variadic",
): FunctionDef {
  return {
    name,
    returnType,
    minArgs,
    maxArgs,
    fn: () => {
      throw new Error(`stub function ${name} must never be evaluated`);
    },
  };
}

const registry = new FunctionSet([
  stub("concat", "string", 1, "variadic"),
  stub("if", "any", 3, 3),
  stub("min", "numeric", 0, "variadic"),
]);

function roundtrip(formula: string, options: { dateLiterals?: boolean } = {}): string {
  return print(parseFormula(formula, { registry, ...options }));
}

describe("print (spec/print_visitor_spec.rb port)", () => {
  it("prints a representation of an AST", () => {
    expect(roundtrip("5+4")).toBe("5 + 4");
  });

  // Ruby 3.5.2 print-visitor regression: equal precedence on the right side
  // must keep its parentheses or `10 - 0 - 10` re-parses left-associatively.
  it("handles grouping correctly", () => {
    expect(roundtrip("10 - (0 - 10)")).toBe("10 - (0 - 10)");
  });

  it("quotes string literals", () => {
    expect(roundtrip("Concat('a',   \"B\")")).toBe('CONCAT("a", "B")');
  });

  it("handles unary operations on literals", () => {
    expect(roundtrip("- 4")).toBe("-4");
  });

  it("handles unary operations on trees", () => {
    expect(roundtrip("- (5 + 5)")).toBe("-(5 + 5)");
  });

  // Ruby prints the token's raw text for literals (`3.0`); the frozen AST
  // contract (issue 006) stores only the exact Decimal, so the canonical
  // form `3` is printed instead. Structurally identical on re-parse.
  it("handles a complex arithmetic expression", () => {
    expect(roundtrip("(((1 + 7) * (8 ^ 2)) / - (3.0 - apples))")).toBe(
      "(1 + 7) * 8 ^ 2 / -(3 - apples)",
    );
  });

  it("handles a complex logical expression", () => {
    expect(roundtrip("1 < 2 and 3 <= 4 or 5 > 6 AND 7 >= 8 OR 9 != 10 and true")).toBe(
      "1 < 2 and 3 <= 4 or 5 > 6 and 7 >= 8 or 9 != 10 and true",
    );
  });

  it("handles a function call", () => {
    expect(roundtrip("IF(a[0] = NULL, \"five\", 'seven')")).toBe(
      'IF(a[0] = NULL, "five", "seven")',
    );
  });

  it("handles a case statement", () => {
    expect(roundtrip("case (a % 5) when 0 then a else b end")).toBe(
      "CASE a % 5 WHEN 0 THEN a ELSE b END",
    );
  });

  // Ruby prints the raw hex text; the frozen AST contract (issue 006) keeps
  // only the exact Decimal value, so canonical decimal digits are printed.
  it("handles bitwise operators", () => {
    expect(roundtrip("0xCAFE & 0xDECAF | 0xBEEF")).toBe("51966 & 912559 | 48879");
  });

  // Ruby prints the raw token text (`2017-12-24 23:59:59`); the AST holds a
  // CivilDateTime (issue 004), printed in its canonical ISO form, which the
  // datetime scanner re-parses to the same fields.
  it("handles a datetime literal", () => {
    expect(roundtrip("2017-12-24 23:59:59", { dateLiterals: true })).toBe("2017-12-24T23:59:59");
  });

  // Ruby 3.5.5 print-visitor regression: postfix percentage prints with no
  // spacing and must not trigger bogus parenthesization.
  it("handles a percentage in a formula", () => {
    expect(roundtrip("((3*4%) * 0.001)")).toBe("3 * 4% * 0.001");
  });
});

describe("print (dentaku-ts additions)", () => {
  it("keeps explicit parentheses that defeat left associativity", () => {
    expect(roundtrip("2 ^ (3 ^ 2)")).toBe("2 ^ (3 ^ 2)");
    expect(roundtrip("(2 ^ 3) ^ 2")).toBe("2 ^ 3 ^ 2");
    expect(roundtrip("a / (b * c)")).toBe("a / (b * c)");
  });

  it("parenthesizes a lower-precedence percentage operand", () => {
    expect(roundtrip("(3 + 4)%")).toBe("(3 + 4)%");
  });

  it("prints binary modulo with spacing", () => {
    expect(roundtrip("a % 5 == 0")).toBe("a % 5 = 0");
  });

  it("prints canonical comparator spellings", () => {
    expect(roundtrip("a == b")).toBe("a = b");
    expect(roundtrip("a <> b")).toBe("a != b");
  });

  it("prints array literals with braces", () => {
    expect(roundtrip("{1, 2, 3}")).toBe("{1, 2, 3}");
    expect(roundtrip("{}")).toBe("{}");
    expect(roundtrip("MIN({1, 2}[0], 3)")).toBe("MIN({1, 2}[0], 3)");
  });

  it("prints NULL for the null literal and empty input", () => {
    expect(roundtrip("null")).toBe("NULL");
    expect(roundtrip("")).toBe("NULL");
  });

  it("prints a CASE with several WHENs and no ELSE", () => {
    expect(roundtrip("CASE x WHEN 1 THEN 'a' WHEN 2 THEN 'b' END")).toBe(
      'CASE x WHEN 1 THEN "a" WHEN 2 THEN "b" END',
    );
  });

  it("backtick-quotes identifiers that are not in plain word form", () => {
    expect(roundtrip("`hello world` + 1")).toBe("`hello world` + 1");
    expect(print(new IdentifierNode("total.net"))).toBe("total.net");
    expect(print(new IdentifierNode("a-b"))).toBe("`a-b`");
  });

  it("flags a string literal containing a double quote as unprintable", () => {
    // Dentaku strings have no escape sequences, so Ruby's `\"` output could
    // never re-parse; the printer refuses instead of emitting broken text.
    expect(() => roundtrip("'say \"hi\"'")).toThrow(/unprintable string literal/);
  });

  it("flags an identifier containing a backtick as unprintable", () => {
    expect(() => print(new IdentifierNode("back`tick"))).toThrow(/unprintable identifier/);
  });

  it("rejects AST nodes it does not know", () => {
    class WeirdNode extends ArrayNode {}
    expect(print(new WeirdNode([new StringNode("x")]))).toBe('{"x"}');
    expect(() => print({ type: null, value: () => null, dependencies: () => [] })).toThrow(
      /cannot print AST node/,
    );
  });
});
