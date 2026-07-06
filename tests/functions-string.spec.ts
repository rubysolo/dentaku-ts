// Ported from Ruby dentaku v3.5.7: spec/ast/string_functions_spec.rb
// (complete), plus edge cases verified by running the gem directly (each is
// annotated), plus the Unicode code-point tests required by issue 008.
//
// Deviations from Ruby, each annotated inline:
// - Numbers stringify via Decimal#toString, not BigDecimal#to_s scientific
//   notation (ADR-0001; issue 008 spec).
// - Ruby raises Dentaku::ArgumentError for bad length/offset arguments; here
//   that is TypeMismatchError carrying Ruby's message wording (issue 008 spec).
import { describe, expect, it } from "vitest";
import { FunctionCallNode, Scope } from "../src/ast/index.js";
import type { Binding } from "../src/ast/node.js";
import { ParseError, TypeMismatchError } from "../src/errors.js";
import { defaultFunctionSet } from "../src/functions/builtins.js";
import { parseFormula } from "../src/parser/parser.js";
import { type ExternalValue, toExternal, toInternal } from "../src/values.js";

const registry = defaultFunctionSet;

function evaluate(formula: string, vars: Record<string, ExternalValue> = {}): ExternalValue {
  const bindings: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(vars)) {
    bindings[k] = toInternal(v);
  }
  return toExternal(parseFormula(formula, { registry }).value(Scope.of(bindings)));
}

function nodeType(formula: string): string | null {
  const node = parseFormula(formula, { registry });
  expect(node).toBeInstanceOf(FunctionCallNode);
  return node.type;
}

describe("LEFT (Dentaku::AST::StringFunctions::Left)", () => {
  it("returns the left N characters of the string", () => {
    expect(evaluate("LEFT(string, length)", { string: "ABCDEFG", length: 4 })).toBe("ABCD");
  });

  it("works correctly with literals", () => {
    expect(evaluate('LEFT("ABCD", 2)')).toBe("AB");
  });

  it("handles an empty string correctly", () => {
    expect(evaluate("LEFT(string, 4)", { string: "" })).toBe("");
  });

  it("handles size greater than input string length correctly", () => {
    expect(evaluate('LEFT("abcdefg", 40)')).toBe("abcdefg");
  });

  it("accepts strings as length if they can be parsed to a number", () => {
    expect(evaluate('LEFT("ABCDEFG", "4")')).toBe("ABCD");
  });

  it("has the proper type", () => {
    expect(nodeType('LEFT("a", 1)')).toBe("string");
  });

  it("raises an error if given invalid length", () => {
    expect(() => evaluate('LEFT("abcdefg", -2)')).toThrow(TypeMismatchError);
    expect(() => evaluate('LEFT("abcdefg", -2)')).toThrow(
      /LEFT\(\) requires length to be positive/,
    );
  });

  it("raises an error when given a junk length", () => {
    expect(() => evaluate('LEFT("abcdefg", "junk")')).toThrow(TypeMismatchError);
    expect(() => evaluate('LEFT("abcdefg", "junk")')).toThrow("'junk' is not coercible to numeric");
  });

  it("truncates a fractional length toward zero", () => {
    // Verified against the gem: LEFT("abcdefg", 4.7) => "abcd" (Ruby .to_i).
    expect(evaluate('LEFT("abcdefg", 4.7)')).toBe("abcd");
    // -0.5 truncates to 0 BEFORE the negative check, so no error is raised.
    expect(evaluate('LEFT("abcdefg", -0.5)')).toBe("");
  });

  it("checks the sign after coercing a string length", () => {
    // Verified against the gem: LEFT("abcdefg", "-2") raises the positive error.
    expect(() => evaluate('LEFT("abcdefg", "-2")')).toThrow(
      /LEFT\(\) requires length to be positive/,
    );
  });

  it("stringifies a numeric subject", () => {
    // Verified against the gem: LEFT(123456, 3) => "123".
    expect(evaluate("LEFT(123456, 3)")).toBe("123");
  });

  it("rejects null and boolean lengths as non-coercible", () => {
    // Ruby: "'NilClass' is not coercible to numeric" — the class-name leakage
    // is not reproduced; the message shows the JS-side spelling instead.
    expect(() => evaluate('LEFT("abc", x)', { x: null })).toThrow(
      "'null' is not coercible to numeric",
    );
    // Matches Ruby exactly: true is truthy, so Ruby also renders 'true'.
    expect(() => evaluate('LEFT("abc", x)', { x: true })).toThrow(
      "'true' is not coercible to numeric",
    );
  });

  it("counts code points, not UTF-16 units", () => {
    expect(evaluate('LEFT("💀💀a", 2)')).toBe("💀💀");
  });
});

describe("RIGHT (Dentaku::AST::StringFunctions::Right)", () => {
  it("returns the right N characters of the string", () => {
    expect(evaluate('RIGHT("ABCDEFG", 4)')).toBe("DEFG");
  });

  it("handles an empty string correctly", () => {
    expect(evaluate('RIGHT("", 4)')).toBe("");
  });

  it("handles size greater than input string length correctly", () => {
    expect(evaluate('RIGHT("abcdefg", 40)')).toBe("abcdefg");
  });

  it("accepts strings as length if they can be parsed to a number", () => {
    expect(evaluate('RIGHT("ABCDEFG", "4")')).toBe("DEFG");
  });

  it("has the proper type", () => {
    expect(nodeType('RIGHT("a", 1)')).toBe("string");
  });

  it("raises an error when given a junk length", () => {
    expect(() => evaluate('RIGHT("abcdefg", "junk")')).toThrow(TypeMismatchError);
    expect(() => evaluate('RIGHT("abcdefg", "junk")')).toThrow(
      "'junk' is not coercible to numeric",
    );
  });

  it("raises an error if given invalid length", () => {
    // Not in the Ruby spec but in the Ruby implementation; verified against
    // the gem: RIGHT("abcdefg", -2) raises the positive error.
    expect(() => evaluate('RIGHT("abcdefg", -2)')).toThrow(
      /RIGHT\(\) requires length to be positive/,
    );
  });

  it("handles a zero length", () => {
    // Verified against the gem: RIGHT("abcdefg", 0) => "".
    expect(evaluate('RIGHT("abcdefg", 0)')).toBe("");
  });

  it("counts code points, not UTF-16 units", () => {
    // Verified against the gem: RIGHT("💀💀a", 2) => "💀a".
    expect(evaluate('RIGHT("💀💀a", 2)')).toBe("💀a");
  });
});

describe("MID (Dentaku::AST::StringFunctions::Mid)", () => {
  it("returns a substring from the middle of the string", () => {
    expect(evaluate('MID("ABCDEFG", 4, 2)')).toBe("DE");
  });

  it("handles an empty string correctly", () => {
    expect(evaluate('MID("", 4, 2)')).toBe("");
  });

  it("handles offset greater than input string length correctly", () => {
    expect(evaluate('MID("abcdefg", 40, 4)')).toBe("");
  });

  it("handles size greater than input string length correctly", () => {
    expect(evaluate('MID("abcdefg", 4, 40)')).toBe("defg");
  });

  it("accepts strings as offset and length if they can be parsed to a number", () => {
    expect(evaluate('MID("ABCDEFG", "4", "2")')).toBe("DE");
  });

  it("has the proper type", () => {
    expect(nodeType('MID("a", 1, 1)')).toBe("string");
  });

  it("raises an error when given a junk offset", () => {
    expect(() => evaluate('MID("abcdefg", "junk offset", 2)')).toThrow(TypeMismatchError);
    expect(() => evaluate('MID("abcdefg", "junk offset", 2)')).toThrow(
      "'junk offset' is not coercible to numeric",
    );
  });

  it("raises an error when given a junk length", () => {
    expect(() => evaluate('MID("abcdefg", 4, "junk")')).toThrow(TypeMismatchError);
    expect(() => evaluate('MID("abcdefg", 4, "junk")')).toThrow(
      "'junk' is not coercible to numeric",
    );
  });

  it("raises an error when given a negative offset", () => {
    // Verified against the gem: MID("abcdefg", -1, 2) raises this message.
    expect(() => evaluate('MID("abcdefg", 0 - 1, 2)')).toThrow(
      /MID\(\) requires offset to be positive/,
    );
  });

  it("raises an error when given a negative length", () => {
    // Verified against the gem: MID("abcdefg", 2, -1) raises this message.
    expect(() => evaluate('MID("abcdefg", 2, 0 - 1)')).toThrow(
      /MID\(\) requires length to be positive/,
    );
  });

  it("wraps offset 0 to the last character (Ruby negative-index parity)", () => {
    // Ruby indexes with string[offset - 1, length]; offset 0 becomes index -1.
    // Verified against the gem: MID("abcdefg", 0, 4) => "g"; MID("", 0, 4) => "".
    expect(evaluate('MID("abcdefg", 0, 4)')).toBe("g");
    expect(evaluate('MID("", 0, 4)')).toBe("");
  });

  it("handles a zero length", () => {
    // Verified against the gem: MID("abcdefg", 1, 0) => "".
    expect(evaluate('MID("abcdefg", 1, 0)')).toBe("");
  });

  it("truncates fractional offset and length toward zero", () => {
    // Verified against the gem: MID("abcdefg", 2.9, 3.9) => "bcd".
    expect(evaluate('MID("abcdefg", 2.9, 3.9)')).toBe("bcd");
  });

  it("counts code points, not UTF-16 units", () => {
    expect(evaluate('MID("a💀b", 2, 1)')).toBe("💀");
  });
});

describe("LEN (Dentaku::AST::StringFunctions::Len)", () => {
  it("returns the length of a string", () => {
    expect(evaluate('LEN("ABCDEFG")')).toBe(7);
  });

  it("handles an empty string correctly", () => {
    expect(evaluate('LEN("")')).toBe(0);
  });

  it("has the proper type", () => {
    expect(nodeType('LEN("a")')).toBe("numeric");
  });

  it("counts code points, not UTF-16 units", () => {
    // Issue 008 astral-plane requirement; Ruby strings are character-based.
    expect(evaluate('LEN("💀💀")')).toBe(2);
  });

  it("stringifies non-string subjects", () => {
    // Verified against the gem: LEN(5) => 1, LEN(true) => 4.
    expect(evaluate("LEN(5)")).toBe(1);
    expect(evaluate("LEN(true)")).toBe(4);
    expect(evaluate("LEN(x)", { x: null })).toBe(0);
  });

  it("rejects extra arguments at parse time", () => {
    expect(() => evaluate('LEN("a", "b")')).toThrow(ParseError);
  });
});

describe("FIND (Dentaku::AST::StringFunctions::Find)", () => {
  it("returns the position of a substring within a string", () => {
    expect(evaluate('FIND("DE", "ABCDEFG")')).toBe(4);
  });

  it("handles an empty substring correctly", () => {
    expect(evaluate('FIND("", "ABCDEFG")')).toBe(1);
  });

  it("handles an empty string correctly", () => {
    expect(evaluate('FIND("DE", "")')).toBeNull();
  });

  it("has the proper type", () => {
    expect(nodeType('FIND("a", "b")')).toBe("numeric");
  });

  it("returns null when the needle does not occur", () => {
    expect(evaluate('FIND("x", "abcdefg")')).toBeNull();
  });

  it("finds an empty needle in an empty haystack", () => {
    // Verified against the gem: FIND("", "") => 1.
    expect(evaluate('FIND("", "")')).toBe(1);
  });

  it("returns a 1-based position in code points, not UTF-16 units", () => {
    expect(evaluate('FIND("B", "💀💀B")')).toBe(3);
  });
});

describe("SUBSTITUTE (Dentaku::AST::StringFunctions::Substitute)", () => {
  it("replaces a substring within a string", () => {
    expect(evaluate('SUBSTITUTE("ABCDEFG", "DE", "xy")')).toBe("ABCxyFG");
  });

  it("handles an empty search string correctly", () => {
    expect(evaluate('SUBSTITUTE("ABCDEFG", "", "xy")')).toBe("xyABCDEFG");
  });

  it("handles an empty replacement string correctly", () => {
    expect(evaluate('SUBSTITUTE("ABCDEFG", "DE", "")')).toBe("ABCFG");
  });

  it("has the proper type", () => {
    expect(nodeType('SUBSTITUTE("a", "b", "c")')).toBe("string");
  });

  it("replaces only the FIRST occurrence (Ruby String#sub)", () => {
    // Verified against the gem: SUBSTITUTE("ABCDEABCDE", "DE", "xy") => "ABCxyABCDE".
    expect(evaluate('SUBSTITUTE("ABCDEABCDE", "DE", "xy")')).toBe("ABCxyABCDE");
  });

  it("returns the original string when the search does not occur", () => {
    // Verified against the gem: SUBSTITUTE("", "X", "-") => "".
    expect(evaluate('SUBSTITUTE("", "X", "-")')).toBe("");
    expect(evaluate('SUBSTITUTE("abc", "X", "-")')).toBe("abc");
  });

  it("treats the replacement literally (no $-pattern interpolation)", () => {
    expect(evaluate('SUBSTITUTE("abc", "b", "$&")')).toBe("a$&c");
  });

  it("stringifies non-string arguments", () => {
    // Verified against the gem: SUBSTITUTE("abc", "b", 5) => "a5c".
    expect(evaluate('SUBSTITUTE("abc", "b", 5)')).toBe("a5c");
  });
});

describe("CONCAT (Dentaku::AST::StringFunctions::Concat)", () => {
  it("concatenates two strings", () => {
    expect(evaluate('CONCAT("ABC", "DEF")')).toBe("ABCDEF");
  });

  it("concatenates a string onto an empty string", () => {
    expect(evaluate('CONCAT("", "ABC")')).toBe("ABC");
  });

  it("concatenates an empty string onto a string", () => {
    expect(evaluate('CONCAT("ABC", "")')).toBe("ABC");
  });

  it("concatenates two empty strings", () => {
    expect(evaluate('CONCAT("", "")')).toBe("");
  });

  it("has the proper type", () => {
    expect(nodeType('CONCAT("a", "b")')).toBe("string");
  });

  it("accepts a single argument", () => {
    // Verified against the gem: CONCAT("a") => "a" (min_param_count 1).
    expect(evaluate('CONCAT("a")')).toBe("a");
  });

  it("is variadic beyond two arguments", () => {
    expect(evaluate('CONCAT("a", "b", "c", "d")')).toBe("abcd");
  });

  it("rejects zero arguments at parse time", () => {
    expect(() => evaluate("CONCAT()")).toThrow(ParseError);
  });

  it("stringifies non-string arguments", () => {
    // ADR-0001 deviation: Ruby renders 2.5 via BigDecimal#to_s as "0.25e1"
    // (gem yields "10.25e1a" here); Decimal#toString gives plain "2.5".
    expect(evaluate('CONCAT(1, 2.5, "a")')).toBe("12.5a");
    // Verified against the gem: negative numbers render with the sign.
    expect(evaluate('CONCAT("a", 0 - 2)')).toBe("a-2");
    // Ruby to_s parity: nil => "", booleans => "true"/"false".
    expect(evaluate('CONCAT(x, "x")', { x: null })).toBe("x");
    expect(evaluate("CONCAT(true, false)")).toBe("truefalse");
  });
});

describe("CONTAINS (Dentaku::AST::StringFunctions::Contains)", () => {
  it("checks for substrings", () => {
    expect(evaluate('CONTAINS("app", "apple")')).toBe(true);
    expect(evaluate('CONTAINS("app", "orange")')).toBe(false);
  });

  it("has the proper type", () => {
    expect(nodeType('CONTAINS("a", "b")')).toBe("logical");
  });

  it("is case-sensitive", () => {
    // Verified against the gem: CONTAINS("APP", "apple") => false.
    expect(evaluate('CONTAINS("APP", "apple")')).toBe(false);
  });

  it("finds an empty needle in any haystack", () => {
    // Verified against the gem: CONTAINS("", "apple") => true.
    expect(evaluate('CONTAINS("", "apple")')).toBe(true);
    expect(evaluate('CONTAINS("", "")')).toBe(true);
  });
});

describe("string function registration", () => {
  it("names are case-insensitive", () => {
    expect(evaluate('left("ABCD", 2)')).toBe("AB");
    expect(evaluate('Contains("app", "apple")')).toBe(true);
  });
});
