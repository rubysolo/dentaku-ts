// Ported from Ruby dentaku v3.5.7: spec/parser_spec.rb, plus the targeted
// precedence cases from docs/issues/006-parser-evaluator-core.md.
// Deviations from Ruby behavior are annotated with their ADR tightening.
import { describe, expect, it } from "vitest";
import {
  BitwiseNode,
  ComparatorNode,
  IdentifierNode,
  NilNode,
  requireBoolean,
  Scope,
} from "../src/ast/index.js";
import type { Binding, Node } from "../src/ast/node.js";
import { Decimal } from "../src/decimal.js";
import { ParseError, TypeMismatchError, UnboundVariableError } from "../src/errors.js";
import { FunctionSet } from "../src/functions/registry.js";
import type { FunctionDef } from "../src/functions/types.js";
import { type ParseFormulaOptions, parse, parseFormula } from "../src/parser/parser.js";
import { tokenize } from "../src/tokenizer/tokenizer.js";
import { type ExternalValue, toExternal, toInternal, type Value } from "../src/values.js";

// Throwaway FunctionDefs for parser-level tests; the real packs land in 007-010.
const throwawayFunctions = new FunctionSet([
  {
    name: "if",
    returnType: "any",
    minArgs: 3,
    maxArgs: 3,
    rawFn: (args, ctx) => {
      const [pred, thenNode, elseNode] = args as [Node, Node, Node];
      return requireBoolean(pred.value(ctx), "if") ? thenNode.value(ctx) : elseNode.value(ctx);
    },
  },
  {
    // Ruby COUNT: length of a single enumerable argument, else the argument count.
    name: "count",
    returnType: "numeric",
    minArgs: 0,
    maxArgs: "variadic",
    fn: (...args: Value[]) => {
      const only = args.length === 1 ? args[0] : undefined;
      return new Decimal(Array.isArray(only) ? only.length : args.length);
    },
  },
  {
    name: "concat",
    returnType: "string",
    minArgs: 1,
    maxArgs: "variadic",
    fn: (...args: Value[]) => args.map((a) => String(a)).join(""),
  },
] satisfies FunctionDef[]);

function ast(formula: string, options: Omit<ParseFormulaOptions, "registry"> = {}): Node {
  return parseFormula(formula, { ...options, registry: throwawayFunctions });
}

function context(vars: Record<string, ExternalValue | Binding> = {}): Scope {
  const bindings: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(vars)) {
    bindings[k] =
      typeof v === "function" || (typeof v === "object" && v !== null && "dependencies" in v)
        ? (v as Binding)
        : toInternal(v as ExternalValue);
  }
  return Scope.of(bindings);
}

/** parse + evaluate + convert outward, for readable expectations. */
function evaluate(formula: string, vars: Record<string, ExternalValue> = {}): ExternalValue {
  return toExternal(ast(formula).value(context(vars)));
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

describe("parser (spec/parser_spec.rb)", () => {
  it("parses an integer literal", () => {
    expect(evaluate("5")).toBe(5);
  });

  it("performs simple addition", () => {
    expect(evaluate("5 + 4")).toBe(9);
  });

  it("compares two numbers", () => {
    expect(evaluate("5 < 4")).toBe(false);
  });

  it("calculates unary percentage", () => {
    expect(evaluate("5%")).toBe(0.05);
  });

  it("calculates bitwise OR", () => {
    expect(evaluate("2|3")).toBe(3);
    expect(evaluate("(5 | 2) + 1")).toBe(8);
  });

  it("performs multiple operations in one stream", () => {
    expect(evaluate("5 * 4 + 3")).toBe(23);
  });

  it("respects order of operations", () => {
    expect(evaluate("5 + 4*3")).toBe(17);
  });

  it("respects grouping by parenthesis", () => {
    expect(evaluate("(5 + 4) * 3")).toBe(27);
  });

  it("evaluates functions", () => {
    expect(evaluate("IF(5 < 4, 3, 2)")).toBe(2);
  });

  it("parses multiple zero-argument functions in sequence", () => {
    expect(evaluate("count() + count()")).toBe(0);
  });

  it("represents formulas with variables", () => {
    const node = ast("5 * x");
    expect(() => node.value(context())).toThrow(UnboundVariableError);
    expect(toExternal(node.value(context({ x: 3 })))).toBe(15);
  });

  it("evaluates access into data structures", () => {
    const node = ast("a[1]");
    expect(() => node.value(context())).toThrow(UnboundVariableError);
    expect(toExternal(node.value(context({ a: [1, 2, 3] })))).toBe(2);
  });

  it("evaluates boolean expressions", () => {
    expect(evaluate("true AND false")).toBe(false);
  });

  it("evaluates a case statement", () => {
    expect(evaluate("CASE x WHEN 1 THEN 2 WHEN 3 THEN 4 END", { x: 3 })).toBe(4);
  });

  it("evaluates a nested case statement with case-sensitivity", () => {
    // ADR-0003.1: identifiers are case-sensitive by default (Ruby needed
    // case_sensitive: true on both tokenizer and parser for this).
    const formula = 'CASE x WHEN 1 THEN CASE Y WHEN "A" THEN 2 WHEN "B" THEN 3 END END';
    expect(evaluate(formula, { x: 1, y: "A", Y: "B" })).toBe(3);
  });

  it("evaluates arrays", () => {
    expect(evaluate("{}")).toEqual([]);
    expect(evaluate("{1, 2, 3}")).toEqual([1, 2, 3]);

    // ADR-0003.3: arithmetic operands must be numeric — Ruby concatenated
    // ({1,2,3} + {4,5,6} == [1,2,3,4,5,6]) and diffed ({1,2,3} - {2,3} == [1]).
    expect(() => evaluate("{1, 2, 3} + {4,5,6}")).toThrow(TypeMismatchError);
    expect(() => evaluate("{1, 2, 3} - {2,3}")).toThrow(TypeMismatchError);
  });

  describe("invalid expression", () => {
    it("raises a parse error for bad math", () => {
      expect(() => ast("5 * -")).toThrow(ParseError);
    });

    it("raises a parse error for bad logic", () => {
      expect(() => ast("TRUE AND")).toThrow(ParseError);
    });

    it("raises a parse error for too many operands", () => {
      expect(() => ast("IF(1, 0, IF(1, 2, 3, 4))")).toThrow(ParseError);
      expect(() => ast("CASE a WHEN 1 THEN true ELSE THEN IF(1, 2, 3, 4) END")).toThrow(ParseError);
    });

    it("raises a parse error for bad grouping structure", () => {
      expect(() => ast(",")).toThrow(ParseError);
      expect(() => ast("5, x")).toThrow(ParseError);
      expect(() => ast("5 + 5, x")).toThrow(ParseError);
      expect(() => ast("{1, 2, }")).toThrow(ParseError);
      expect(() => ast("CONCAT('1', '2', )")).toThrow(ParseError);
    });

    it("raises parse errors for malformed case statements", () => {
      expect(() => ast("CASE a when 'one' then 1")).toThrow(ParseError);
      expect(() => ast("case a whend 'one' then 1 end")).toThrow(ParseError);
      expect(() => ast("CASE a WHEN 'one' THEND 1 END")).toThrow(ParseError);
      expect(() => ast("CASE a when 'one' then end")).toThrow(ParseError);
    });

    it("raises a parse error when trying to access an undefined function", () => {
      const error = parseErrorFrom(() => ast("undefined()"));
      expect(error.reason).toBe("undefined-function");
    });
  });

  it("evaluates explicit 'NULL' as nil", () => {
    expect(evaluate("NULL")).toBeNull();
  });
});

describe("parser (issue 006 additions)", () => {
  it("parses an empty token list to NilNode", () => {
    expect(parse([])).toBeInstanceOf(NilNode);
    expect(ast("")).toBeInstanceOf(NilNode);
    expect(evaluate("")).toBeNull();
  });

  it("parses '2 | 3 = 3' as '(2|3) = 3' (ADR-0003.4 bitwise precedence)", () => {
    // Ruby put `|` at precedence 0, parsing this as 2 | (3 = 3).
    const node = ast("2 | 3 = 3");
    expect(node).toBeInstanceOf(ComparatorNode);
    expect((node as ComparatorNode).left).toBeInstanceOf(BitwiseNode);
    expect(evaluate("2 | 3 = 3")).toBe(true);
  });

  it("binds unary minus tighter than ^ (Ruby parity)", () => {
    expect(evaluate("-2 ^ 2")).toBe(4);
    expect(evaluate("-2 ^ 3")).toBe(-8);
  });

  it("treats ^ as left-associative (Ruby parity)", () => {
    expect(evaluate("2 ^ 3 ^ 2")).toBe(64);
  });

  it("keeps percentage exact: 50% * 2 is exactly 1", () => {
    // Ruby leaked a Float here (50 * 0.01); dentaku-ts stays exact Decimal.
    const result = ast("50% * 2").value(context());
    expect(result).toBeInstanceOf(Decimal);
    expect((result as Decimal).eq(1)).toBe(true);
    expect((result as Decimal).toString()).toBe("1");
  });

  it("disambiguates percentage from modulo by lookahead (Ruby parity)", () => {
    expect(evaluate("5 % 2")).toBe(1); // next token numeric → modulo
    expect(evaluate("5%")).toBe(0.05); // next token nothing → percentage
    expect(evaluate("(50%)")).toBe(0.5); // next token close-paren → percentage
    expect(evaluate("50% * 2")).toBe(1); // next token operator → percentage
    // Ruby parity quirk: '- 1' after '%' scans as negate, so this cannot parse.
    expect(() => ast("50% - 1")).toThrow(ParseError);
  });

  it("reports arity violations with Ruby's reason codes", () => {
    const two: FunctionDef = {
      name: "two",
      returnType: "numeric",
      minArgs: 2,
      maxArgs: 2,
      fn: () => null,
    };
    const registry = throwawayFunctions.withFunction(two);
    expect(parseErrorFrom(() => parseFormula("two(1)", { registry })).reason).toBe(
      "too-few-operands",
    );
    expect(parseErrorFrom(() => parseFormula("two()", { registry })).reason).toBe(
      "too-few-operands",
    );
    expect(parseErrorFrom(() => parseFormula("two(1, 2, 3)", { registry })).reason).toBe(
      "too-many-operands",
    );
    expect(() => parseFormula("two(1, 2)", { registry })).not.toThrow();
  });

  it("defaults min/max arity from fn.length", () => {
    const pair: FunctionDef = {
      name: "pair",
      returnType: "list",
      fn: (a: Value, b: Value) => [a, b],
    };
    const registry = throwawayFunctions.withFunction(pair);
    expect(() => parseFormula("pair(1, 2)", { registry })).not.toThrow();
    expect(parseErrorFrom(() => parseFormula("pair(1)", { registry })).reason).toBe(
      "too-few-operands",
    );
    expect(parseErrorFrom(() => parseFormula("pair(1, 2, 3)", { registry })).reason).toBe(
      "too-many-operands",
    );
  });

  it("runs FunctionDef.checkArgs at parse time", () => {
    const checked: FunctionDef = {
      name: "checked",
      returnType: "any",
      minArgs: 1,
      maxArgs: "variadic",
      fn: (...args: Value[]) => args[0] ?? null,
      checkArgs: (argNodes) => {
        if (!(argNodes[0] instanceof IdentifierNode)) {
          throw new ParseError("checked() requires an identifier first argument", "node-invalid");
        }
      },
    };
    const registry = throwawayFunctions.withFunction(checked);
    expect(() => parseFormula("checked(x, 1)", { registry })).not.toThrow();
    expect(parseErrorFrom(() => parseFormula("checked(1)", { registry })).reason).toBe(
      "node-invalid",
    );
  });

  it("parses datetime literals only under the dateLiterals option (ADR-0003.5)", () => {
    expect(evaluate("2020-1-1")).toBe(2018); // arithmetic by default
    const node = ast("2020-01-01", { dateLiterals: true });
    expect(node.type).toBe("datetime");
  });

  it("rejects statically non-numeric operands at parse time (Ruby parity)", () => {
    expect(parseErrorFrom(() => ast("'a' + 1")).reason).toBe("node-invalid");
    expect(parseErrorFrom(() => ast("-true")).reason).toBe("node-invalid");
    expect(parseErrorFrom(() => ast("1 and true")).reason).toBe("node-invalid");
  });

  it("attaches the formula to parse errors raised by parseFormula", () => {
    expect(parseErrorFrom(() => ast("5 * -")).formula).toBe("5 * -");
  });

  it("accepts a raw token stream via parse()", () => {
    const node = parse(tokenize("1 + 2"));
    expect(toExternal(node.value(context()))).toBe(3);
  });
});
