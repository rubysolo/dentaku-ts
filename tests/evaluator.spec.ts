// Ported from Ruby dentaku v3.5.7: spec/ast/{arithmetic,addition,division,
// negation,comparator,case,node,numeric}_spec.rb and the operator-form cases
// of spec/ast/and_spec.rb (plus the Or operator analog), plus the evaluator
// semantics required by docs/issues/006-parser-evaluator-core.md.
//
// Every deviation from Ruby behavior is annotated with its ADR tightening:
//   ADR-0003.2 strict booleans in combinators
//   ADR-0003.3 no string→number coercion; typed-pair comparators
//   ADR-0003.4 bitwise via BigInt on integral Decimals
// Ruby cases that cannot be expressed in the Value model (operands with custom
// arithmetic methods, e.g. CanHazMath/Addable/Divisible) have no port: the
// Value union deliberately admits no host objects.
import { describe, expect, it } from "vitest";
import {
  ArithmeticNode,
  CaseConditionalNode,
  CaseElseNode,
  CaseNode,
  CaseSwitchVariableNode,
  CaseThenNode,
  CaseWhenNode,
  CombinatorNode,
  ComparatorNode,
  DatetimeNode,
  FunctionCallNode,
  GroupingNode,
  IdentifierNode,
  isNode,
  LogicalNode,
  NegationNode,
  NumericNode,
  requireBoolean,
  Scope,
  StringNode,
} from "../src/ast/index.js";
import type { Binding, EvalContext, Node } from "../src/ast/node.js";
import { CivilDateTime, Duration } from "../src/civil-date.js";
import { Decimal } from "../src/decimal.js";
import {
  ParseError,
  TypeMismatchError,
  UnboundVariableError,
  ZeroDivisionError,
} from "../src/errors.js";
import { FunctionSet } from "../src/functions/registry.js";
import type { FunctionDef } from "../src/functions/types.js";
import { type ParseFormulaOptions, parseFormula } from "../src/parser/parser.js";
import { type ExternalValue, toExternal, toInternal, type Value } from "../src/values.js";

// --- helpers -----------------------------------------------------------------

const registry = new FunctionSet([
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
] satisfies FunctionDef[]);

function context(vars: Record<string, unknown> = {}): Scope {
  const bindings: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (
      typeof v === "function" ||
      v instanceof Decimal ||
      v instanceof Duration ||
      v instanceof CivilDateTime ||
      (typeof v === "object" && v !== null && isNode(v as Binding))
    ) {
      bindings[k] = v as Binding;
    } else {
      bindings[k] = toInternal(v as ExternalValue);
    }
  }
  return Scope.of(bindings);
}

function ast(formula: string, options: Omit<ParseFormulaOptions, "registry"> = {}): Node {
  return parseFormula(formula, { ...options, registry });
}

function evaluate(
  formula: string,
  vars: Record<string, unknown> = {},
  options: Omit<ParseFormulaOptions, "registry"> = {},
): ExternalValue {
  return toExternal(ast(formula, options).value(context(vars)));
}

function num(n: number | string): NumericNode {
  return new NumericNode(new Decimal(n));
}

const arith =
  (op: "add" | "subtract" | "multiply" | "divide") =>
  (left: Node, right: Node, ctx: EvalContext): Value =>
    new ArithmeticNode(op, left, right).value(ctx);

const add = arith("add");
const sub = arith("subtract");
const mul = arith("multiply");
const div = arith("divide");
const neg = (node: Node, ctx: EvalContext): Value => new NegationNode(node).value(ctx);

// --- spec/ast/arithmetic_spec.rb ----------------------------------------------

describe("AST arithmetic (spec/ast/arithmetic_spec.rb)", () => {
  const one = num(1);
  const two = num(2);
  const x = new IdentifierNode("x");
  const y = new IdentifierNode("y");
  const ctx = context({ x: 1, y: 2 });
  const date = new DatetimeNode(CivilDateTime.of(2020, 4, 16));

  it("performs an arithmetic operation with numeric operands", () => {
    expect(toExternal(add(one, two, ctx))).toBe(3);
    expect(toExternal(sub(one, two, ctx))).toBe(-1);
    expect(toExternal(mul(one, two, ctx))).toBe(2);
    expect(toExternal(div(one, two, ctx))).toBe(0.5);
    expect(toExternal(neg(one, ctx))).toBe(-1);
  });

  it("performs an arithmetic operation with one numeric and one identifier operand", () => {
    expect(toExternal(add(one, x, ctx))).toBe(2);
    expect(toExternal(sub(one, x, ctx))).toBe(0);
    expect(toExternal(mul(one, x, ctx))).toBe(1);
    expect(toExternal(div(one, x, ctx))).toBe(1);

    expect(toExternal(add(y, two, ctx))).toBe(4);
    expect(toExternal(sub(y, two, ctx))).toBe(0);
    expect(toExternal(mul(y, two, ctx))).toBe(4);
    expect(toExternal(div(y, two, ctx))).toBe(1);
  });

  it("performs an arithmetic operation with identifier operands", () => {
    expect(toExternal(add(x, y, ctx))).toBe(3);
    expect(toExternal(sub(x, y, ctx))).toBe(-1);
    expect(toExternal(mul(x, y, ctx))).toBe(2);
    expect(toExternal(div(x, y, ctx))).toBe(0.5);
    expect(toExternal(neg(x, ctx))).toBe(-1);
  });

  it("rejects string operands at eval time (ADR-0003.3)", () => {
    // Ruby coerced '1'/'1.1'/'.1' context values to numbers here; dentaku-ts
    // has no string→number coercion in arithmetic.
    expect(() => add(x, one, context({ x: "1" }))).toThrow(TypeMismatchError);
    expect(() => add(x, one, context({ x: "1.1" }))).toThrow(TypeMismatchError);
    expect(() => add(x, one, context({ x: ".1" }))).toThrow(TypeMismatchError);
    // These two raised Dentaku::ArgumentError in Ruby as well.
    expect(() => add(x, one, context({ x: "invalid" }))).toThrow(TypeMismatchError);
    expect(() => add(x, one, context({ x: "" }))).toThrow(TypeMismatchError);
  });

  it("rejects arithmetic on arrays (ADR-0003.3)", () => {
    // Ruby: [1] + [2] == [1, 2] and [1] - [2] == [1] via Ruby Array algebra.
    expect(() => add(x, y, context({ x: [1], y: [2] }))).toThrow(TypeMismatchError);
    expect(() => sub(x, y, context({ x: [1], y: [2] }))).toThrow(TypeMismatchError);
  });

  it("performs date arithmetic", () => {
    const plus = add(date, one, ctx) as CivilDateTime;
    expect(plus.toISO()).toBe("2020-04-17");
    const minus = sub(date, one, ctx) as CivilDateTime;
    expect(minus.toISO()).toBe("2020-04-15");
  });

  it("does not try to parse nested strings as dates (ADR-0003.3)", () => {
    // Ruby: array difference gave ['2017-01-02']; arithmetic on arrays is a
    // type error in dentaku-ts.
    const vars = { a: ["2017-01-01", "2017-01-02"], b: ["2017-01-01"] };
    expect(() => evaluate("a - b", vars)).toThrow(TypeMismatchError);
    expect(() => evaluate("a + b", vars)).toThrow(TypeMismatchError);
  });

  it("raises if given individually valid but incompatible arguments", () => {
    // Ruby raised Dentaku::ArgumentError for both.
    expect(() => add(one, date, ctx)).toThrow(TypeMismatchError);
    expect(() => add(x, one, context({ x: [1] }))).toThrow(TypeMismatchError);
  });
});

// --- spec/ast/addition_spec.rb -------------------------------------------------

describe("AST addition (spec/ast/addition_spec.rb)", () => {
  const five = num(5);
  const six = num(6);
  const t = new LogicalNode(true);

  it("allows access to its sub-trees", () => {
    const node = new ArithmeticNode("add", five, six);
    expect(node.left).toBe(five);
    expect(node.right).toBe(six);
  });

  it("performs addition", () => {
    expect(toExternal(new ArithmeticNode("add", five, six).value(context()))).toBe(11);
  });

  it("requires operands with a compatible static type", () => {
    // Ruby raised NodeError (surfaced by the parser as ParseError).
    expect(() => new ArithmeticNode("add", five, t)).toThrow(ParseError);

    const expression = new ArithmeticNode("multiply", five, five);
    const group = new GroupingNode(expression);
    expect(() => new ArithmeticNode("add", group, five)).not.toThrow();
  });
});

// --- spec/ast/division_spec.rb -------------------------------------------------

describe("AST division (spec/ast/division_spec.rb)", () => {
  const five = num(5);
  const six = num(6);
  const t = new LogicalNode(true);

  it("allows access to its sub-trees", () => {
    const node = new ArithmeticNode("divide", five, six);
    expect(node.left).toBe(five);
    expect(node.right).toBe(six);
  });

  it("performs division", () => {
    const result = new ArithmeticNode("divide", five, six).value(context()) as Decimal;
    expect(result.toDecimalPlaces(4).toNumber()).toBe(0.8333);
  });

  it("requires operands with a compatible static type", () => {
    expect(() => new ArithmeticNode("divide", five, t)).toThrow(ParseError);

    const expression = new ArithmeticNode("multiply", five, five);
    const group = new GroupingNode(expression);
    expect(() => new ArithmeticNode("divide", group, five)).not.toThrow();
  });

  it("raises ZeroDivisionError on division or modulo by zero", () => {
    expect(() => evaluate("5 / 0")).toThrow(ZeroDivisionError);
    expect(() => evaluate("5 % 0")).toThrow(ZeroDivisionError);
    expect(() => evaluate("5 / (1 - 1)")).toThrow(ZeroDivisionError);
  });
});

// --- spec/ast/negation_spec.rb -------------------------------------------------

describe("AST negation (spec/ast/negation_spec.rb)", () => {
  const five = num(5);
  const t = new LogicalNode(true);
  const x = new IdentifierNode("x");

  it("allows access to its sub-node", () => {
    const node = new NegationNode(five);
    expect(node.node).toBe(five);
  });

  it("performs negation", () => {
    expect(toExternal(new NegationNode(five).value(context()))).toBe(-5);
  });

  it("requires numeric operands", () => {
    // Ruby raised NodeError /requires numeric operands/.
    expect(() => new NegationNode(t)).toThrow(ParseError);

    const expression = new NegationNode(five);
    const group = new GroupingNode(expression);
    expect(() => new NegationNode(group)).not.toThrow();
  });

  it("rejects string operands (ADR-0003.3)", () => {
    // Ruby coerced '5' to 5 and returned -5.
    const node = new NegationNode(x);
    expect(() => node.value(context({ x: "5" }))).toThrow(TypeMismatchError);
  });

  it("raises an error if the input string is not coercible to numeric", () => {
    const node = new NegationNode(x);
    expect(() => node.value(context({ x: "invalid" }))).toThrow(TypeMismatchError);
  });

  it("raises an error if given a non-numeric argument", () => {
    const node = new NegationNode(x);
    expect(() => node.value(context({ x: true }))).toThrow(TypeMismatchError);
  });
});

// --- spec/ast/comparator_spec.rb -----------------------------------------------

describe("AST comparators (spec/ast/comparator_spec.rb)", () => {
  const one = num(1);
  const oneStr = new StringNode("1");
  const two = num(2);
  const twoStr = new StringNode("2");
  const x = new IdentifierNode("x");
  const y = new IdentifierNode("y");
  const nilly = new IdentifierNode("nilly");
  const ctx = context({ x: "hello", y: "world", nilly: null });

  const cmp = (op: "lt" | "gt" | "le" | "ge" | "ne" | "eq", l: Node, r: Node) =>
    new ComparatorNode(op, l, r);

  it("performs comparison with numeric operands", () => {
    expect(cmp("lt", one, two).value(ctx)).toBe(true);
    expect(cmp("lt", two, one).value(ctx)).toBe(false);
    expect(cmp("gt", two, one).value(ctx)).toBe(true);
    expect(cmp("ne", x, y).value(ctx)).toBe(true);
    expect(cmp("eq", x, y).value(ctx)).toBe(false);
  });

  it("compares string pairs lexicographically", () => {
    expect(cmp("lt", oneStr, twoStr).value(ctx)).toBe(true);
    expect(cmp("lt", new StringNode("hello"), new StringNode("world")).value(ctx)).toBe(true);
  });

  it("rejects numeric/string pairs (ADR-0003.3)", () => {
    // Ruby converted numeric strings and answered true for both.
    expect(() => cmp("lt", one, twoStr).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("lt", oneStr, two).value(ctx)).toThrow(TypeMismatchError);
  });

  it("raises when null is ordered against a number", () => {
    // Ruby raised Dentaku::ArgumentError; the dentaku-ts taxonomy uses
    // TypeMismatchError for operand-type failures.
    expect(() => cmp("lt", one, nilly).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("le", one, nilly).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("gt", one, nilly).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("ge", one, nilly).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("ge", one, x).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("lt", nilly, one).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("le", nilly, one).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("gt", nilly, one).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("ge", nilly, one).value(ctx)).toThrow(TypeMismatchError);
  });

  it("rejects mixed-type equality (ADR-0003.3)", () => {
    // Ruby answered false / true for `1 == nil` / `1 != nil`; typed-pair-only
    // equality makes the mismatch explicit.
    expect(() => cmp("ne", one, nilly).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("eq", one, nilly).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("ne", nilly, one).value(ctx)).toThrow(TypeMismatchError);
    expect(() => cmp("eq", nilly, one).value(ctx)).toThrow(TypeMismatchError);
  });

  it("supports equality on typed pairs beyond numbers and strings", () => {
    expect(evaluate("true = true")).toBe(true);
    expect(evaluate("true != false")).toBe(true);
    expect(evaluate("null = null")).toBe(true);
    expect(evaluate("null != null")).toBe(false);
    expect(evaluate("{1, 2} = {1, 2}")).toBe(true); // deep array equality
    expect(evaluate("{1, {2, 3}} = {1, {2, 3}}")).toBe(true);
    expect(evaluate("{1, 2} != {1, 3}")).toBe(true);
    expect(evaluate("{1} = {1, 1}")).toBe(false);
  });

  it("rejects ordering on unordered types", () => {
    expect(() => evaluate("true < false")).toThrow(TypeMismatchError);
    expect(() => evaluate("{1} < {2}")).toThrow(TypeMismatchError);
  });

  it("returns correct operator symbols", () => {
    expect(cmp("lt", one, two).operator).toBe("<");
    expect(cmp("le", one, two).operator).toBe("<=");
    expect(cmp("gt", one, two).operator).toBe(">");
    expect(cmp("ge", one, two).operator).toBe(">=");
    expect(cmp("ne", x, y).operator).toBe("!=");
    expect(cmp("eq", x, y).operator).toBe("=");
  });
});

// --- spec/ast/case_spec.rb -----------------------------------------------------

describe("CASE with unparenthesized operation switch (gem v4.0.0-pre, f16e75a)", () => {
  it("folds a pending operator into the switch expression at the first WHEN", () => {
    expect(evaluate("CASE a % 5 WHEN 0 THEN a ELSE b END", { a: 10, b: 1 })).toBe(10);
    expect(evaluate("CASE a % 5 WHEN 0 THEN a ELSE b END", { a: 11, b: 1 })).toBe(1);
  });

  it("accepts a comparator switch expression", () => {
    expect(evaluate("CASE a > 5 WHEN true THEN 1 ELSE 2 END", { a: 10 })).toBe(1);
    expect(evaluate("CASE a > 5 WHEN true THEN 1 ELSE 2 END", { a: 3 })).toBe(2);
  });

  it("still parses parenthesized and plain switches identically", () => {
    expect(evaluate("CASE (a % 5) WHEN 0 THEN a ELSE b END", { a: 10, b: 1 })).toBe(10);
    expect(evaluate("CASE a WHEN 10 THEN 1 ELSE 2 END", { a: 10 })).toBe(1);
  });
});

describe("AST case (spec/ast/case_spec.rb)", () => {
  const one = num(1);
  const two = num(2);
  const apple = new StringNode("apple");
  const banana = new StringNode("banana");
  const identifier = new IdentifierNode("fruit");
  const switchNode = new CaseSwitchVariableNode(identifier);

  const when1 = new CaseWhenNode(apple);
  const then1 = new CaseThenNode(one);
  const conditional1 = new CaseConditionalNode(when1, then1);

  const when2 = new CaseWhenNode(banana);
  const then2 = new CaseThenNode(two);
  const conditional2 = new CaseConditionalNode(when2, then2);

  describe("value", () => {
    it("raises an exception if there is no switch variable", () => {
      expect(() => new CaseNode([conditional1, conditional2])).toThrow(
        /Case missing switch variable/,
      );
    });

    it("raises an exception if a non-conditional is passed", () => {
      expect(() => new CaseNode([switchNode, conditional1, when2])).toThrow(ParseError);
    });

    it("tests each conditional against the switch variable", () => {
      const node = new CaseNode([switchNode, conditional1, conditional2]);
      expect(toExternal(node.value(context({ fruit: "banana" })))).toBe(2);
    });

    it("returns null if the conditional is not matched and there is no else", () => {
      // docs/issues/006 spec: no match + no else → null. Ruby raised
      // Dentaku::ArgumentError ("No block matched the switch value").
      const node = new CaseNode([switchNode, conditional1, conditional2]);
      expect(node.value(context({ fruit: "orange" }))).toBeNull();
    });

    it("uses the else value if provided and conditional is not matched", () => {
      const three = num(3);
      const elseStatement = new CaseElseNode(three);
      const node = new CaseNode([switchNode, conditional1, conditional2, elseStatement]);
      expect(toExternal(node.value(context({ fruit: "orange" })))).toBe(3);
    });
  });

  describe("dependencies", () => {
    it("gathers dependencies from switch and conditionals", () => {
      const tax = new IdentifierNode("tax");
      const fallback = new IdentifierNode("fallback");
      const addition = new ArithmeticNode("add", two, tax);
      const conditional = new CaseConditionalNode(
        new CaseWhenNode(banana),
        new CaseThenNode(addition),
      );
      const elseNode = new CaseElseNode(fallback);

      const node = new CaseNode([switchNode, conditional1, conditional, elseNode]);
      expect(node.dependencies()).toEqual(["fruit", "tax", "fallback"]);
    });
  });

  it("matches mixed-type WHEN values without raising (Ruby `==` parity)", () => {
    expect(evaluate("CASE x WHEN 1 THEN 'n' WHEN 'one' THEN 's' END", { x: "one" })).toBe("s");
  });
});

// --- spec/ast/node_spec.rb -------------------------------------------------------

describe("AST node dependencies (spec/ast/node_spec.rb)", () => {
  it("returns list of dependencies", () => {
    expect(ast("x + 5").dependencies()).toEqual(["x"]);
    expect(ast("5 < x").dependencies()).toEqual(["x"]);
    expect(ast("5 < 7").dependencies()).toEqual([]);
    expect(ast("(y * 7)").dependencies()).toEqual(["y"]);
    expect(ast("if(x > 5, y, z)").dependencies()).toEqual(["x", "y", "z"]);
    // Ruby's IF short-circuits dependencies when the predicate is decidable
    // (dependencies('x' => 7) == ['y']); that override belongs to issue 007's
    // real `if` FunctionDef — the generic function node reports the union.
    expect(ast("").dependencies()).toEqual([]);
  });

  it("returns a unique list of dependencies", () => {
    expect(ast("x + x").dependencies()).toEqual(["x"]);
  });

  it("resolves bound identifiers against the context", () => {
    expect(ast("x + y").dependencies(context({ x: 7 }))).toEqual(["y"]);
  });
});

// --- spec/ast/numeric_spec.rb -----------------------------------------------------

describe("AST numeric (spec/ast/numeric_spec.rb)", () => {
  const subject = num(5);

  it("has numeric type", () => {
    expect(subject.type).toBe("numeric");
  });

  it("has no dependencies", () => {
    expect(subject.dependencies()).toEqual([]);
  });
});

// --- spec/ast/and_spec.rb (operator form) + Or analog ------------------------------

describe("AST combinators (spec/ast/and_spec.rb operator form)", () => {
  const t = new LogicalNode(true);
  const f = new LogicalNode(false);
  const five = num(5);

  it("performs logical AND", () => {
    expect(new CombinatorNode("and", t, f).value(context())).toBe(false);
    expect(evaluate("true and false")).toBe(false);
    expect(evaluate("true && true")).toBe(true);
  });

  it("performs logical OR", () => {
    expect(new CombinatorNode("or", t, f).value(context())).toBe(true);
    expect(evaluate("false or false")).toBe(false);
    expect(evaluate("false || true")).toBe(true);
  });

  it("requires logical operands", () => {
    // Ruby raised NodeError /requires logical operands/.
    expect(() => new CombinatorNode("and", t, five)).toThrow(ParseError);

    const expression = new ComparatorNode("le", five, five);
    expect(() => new CombinatorNode("and", t, expression)).not.toThrow();

    const orExpression = new CombinatorNode("or", t, f);
    expect(() => new CombinatorNode("and", t, orExpression)).not.toThrow();
  });

  it("rejects non-boolean operands at eval time (ADR-0003.2)", () => {
    // Ruby truthiness: `1 && true` was true, `nil || false` was false.
    expect(() => evaluate("x and true", { x: 1 })).toThrow(TypeMismatchError);
    expect(() => evaluate("x or false", { x: null })).toThrow(TypeMismatchError);
    expect(() => evaluate("true and y", { y: "yes" })).toThrow(TypeMismatchError);
  });

  it("short-circuits on a decisive left operand (ADR-0003.2)", () => {
    // The right side is never evaluated: no UnboundVariableError.
    expect(evaluate("false and missing")).toBe(false);
    expect(evaluate("true or missing")).toBe(true);
    // Non-short-circuit paths do evaluate the right side.
    expect(() => evaluate("true and missing")).toThrow(UnboundVariableError);
  });

  it("returns booleans, not operand values (ADR-0003.2)", () => {
    expect(evaluate("true and true")).toBe(true);
    expect(evaluate("false or true")).toBe(true);
  });
});

// --- issue 006 evaluator semantics --------------------------------------------------

describe("evaluator: bitwise (ADR-0003.4)", () => {
  it("evaluates bitwise operators on integral Decimals", () => {
    expect(evaluate("6 & 3")).toBe(2);
    expect(evaluate("6 | 3")).toBe(7);
    expect(evaluate("1 << 4")).toBe(16);
    expect(evaluate("16 >> 2")).toBe(4);
  });

  it("stays exact beyond float precision via BigInt", () => {
    const result = ast("4503599627370496 << 4").value(context()) as Decimal;
    expect(result.toString()).toBe("72057594037927936");
  });

  it("rejects non-integral operands", () => {
    expect(() => evaluate("1.5 | 2")).toThrow(TypeMismatchError);
    expect(() => evaluate("2 << 0.5")).toThrow(TypeMismatchError);
    expect(() => evaluate("x & 1", { x: "3" })).toThrow(TypeMismatchError);
  });

  it("binds above comparators and below arithmetic", () => {
    expect(evaluate("1 + 1 << 2")).toBe(8); // (1+1) << 2
    expect(evaluate("2 | 4 & 6")).toBe(6); // 2 | (4 & 6)
  });
});

describe("evaluator: arithmetic details", () => {
  it("divides to a decimal result, never integer division", () => {
    expect(evaluate("5 / 2")).toBe(2.5);
  });

  it("uses floored modulo with decimal divisors (Ruby BigDecimal % parity)", () => {
    expect(evaluate("-5 % 3")).toBe(1);
    expect(evaluate("5 % (-3)")).toBe(-1); // '5 % -3' is a ParseError in Ruby too
    expect(evaluate("x % y", { x: 5, y: -3 })).toBe(-1);
    expect(evaluate("5.5 % 2")).toBe(1.5);
  });

  it("supports fractional exponents", () => {
    const result = ast("9 ^ 0.5").value(context()) as Decimal;
    expect(result.toNumber()).toBeCloseTo(3);
  });

  it("raises on numeric domain violations", () => {
    expect(() => evaluate("0 ^ -1")).toThrow(ZeroDivisionError);
  });

  it("keeps exact decimal arithmetic (no binary float artifacts)", () => {
    const result = ast("0.1 + 0.2").value(context()) as Decimal;
    expect(result.toString()).toBe("0.3");
  });
});

describe("evaluator: datetime arithmetic (ADR-0004)", () => {
  const opts = { dateLiterals: true };

  it("adds days to a datetime", () => {
    const result = ast("2020-04-16 + 15", opts).value(context()) as CivilDateTime;
    expect(result.toISO()).toBe("2020-05-01");
  });

  it("subtracts days from a datetime", () => {
    const result = ast("2020-04-16 - 16", opts).value(context()) as CivilDateTime;
    expect(result.toISO()).toBe("2020-03-31");
  });

  it("subtracts datetimes to Decimal days, fractional when times differ", () => {
    expect(evaluate("2020-04-17 - 2020-04-16", {}, opts)).toBe(1);
    const half = ast("2020-04-16 12:00:00 - 2020-04-16 00:00:00", opts).value(context());
    expect((half as Decimal).toString()).toBe("0.5");
  });

  it("applies durations with month-end clamping (Ruby Date#>> parity)", () => {
    const plusMonth = ast("2020-01-31 + d", opts).value(
      context({ d: new Duration(1, "month") }),
    ) as CivilDateTime;
    expect(plusMonth.toISO()).toBe("2020-02-29");

    const minusYear = ast("2020-02-29 - d", opts).value(
      context({ d: new Duration(1, "year") }),
    ) as CivilDateTime;
    expect(minusYear.toISO()).toBe("2019-02-28");
  });

  it("compares datetime pairs chronologically", () => {
    expect(evaluate("2020-01-01 < 2020-06-01", {}, opts)).toBe(true);
    expect(evaluate("2020-01-01 = 2020-01-01", {}, opts)).toBe(true);
    expect(evaluate("2020-01-01 != 2020-01-02", {}, opts)).toBe(true);
  });

  it("rejects other operators and operands on datetimes", () => {
    expect(() => evaluate("2020-01-01 * 2", {}, opts)).toThrow(TypeMismatchError);
    // A string literal operand is rejected at parse time (Ruby parity).
    expect(() => evaluate("2020-01-01 + 'a'", {}, opts)).toThrow(ParseError);
    expect(() => evaluate("d + s", { d: CivilDateTime.of(2020, 1, 1), s: "a" })).toThrow(
      TypeMismatchError,
    );
    // ADR-0004: no string→date coercion in date arithmetic.
    expect(() => evaluate("d - x", { d: CivilDateTime.of(2020, 1, 1), x: "2019-01-01" })).toThrow(
      TypeMismatchError,
    );
  });
});

describe("evaluator: identifiers and scopes", () => {
  it("throws UnboundVariableError carrying the unbound names", () => {
    try {
      ast("bogus * 2").value(context());
      expect.unreachable("expected UnboundVariableError");
    } catch (e) {
      expect(e).toBeInstanceOf(UnboundVariableError);
      expect((e as UnboundVariableError).unboundVariables).toEqual(["bogus"]);
    }
  });

  it("evaluates Node bindings recursively (storeFormula semantics)", () => {
    const ctx = context({ total: ast("a + b"), a: 2, b: 3 });
    expect(toExternal(ast("total * 2").value(ctx))).toBe(10);
  });

  it("reports the dependencies of Node bindings", () => {
    const ctx = context({ total: ast("a + b"), a: 2 });
    expect(ast("total * 2").dependencies(ctx)).toEqual(["b"]);
  });

  it("calls function-valued bindings lazily", () => {
    let calls = 0;
    const ctx = context({
      lazy: () => {
        calls += 1;
        return new Decimal(21);
      },
      other: 1,
    });
    expect(toExternal(ast("other + 1").value(ctx))).toBe(2);
    expect(calls).toBe(0); // not referenced → never called
    expect(toExternal(ast("lazy * 2").value(ctx))).toBe(42);
    expect(calls).toBe(1);
  });

  it("layers child scopes over parent bindings", () => {
    const parent = context({ x: 1, y: 2 });
    const child = parent.child(new Map<string, Binding>([["x", new Decimal(10)]]));
    expect(toExternal(ast("x + y").value(child))).toBe(12);
    expect(toExternal(ast("x + y").value(parent))).toBe(3);
  });

  it("inherits the strict flag through child scopes", () => {
    const strictScope = new Scope([], { strict: true });
    expect(strictScope.strict).toBe(true);
    expect(strictScope.child(new Map()).strict).toBe(true);
    expect(context().strict).toBe(false);
  });

  it("works against a minimal EvalContext (frozen get-only shape)", () => {
    const minimal: EvalContext = {
      get: (name) => (name === "x" ? new Decimal(4) : undefined),
    };
    expect(toExternal(ast("x * 2").value(minimal))).toBe(8);
    expect(ast("x + y").dependencies(minimal)).toEqual(["y"]);
  });
});

describe("evaluator: access", () => {
  it("indexes arrays with negative wrap-around (Ruby Array#[] parity)", () => {
    expect(evaluate("a[0]", { a: [1, 2, 3] })).toBe(1);
    expect(evaluate("a[-1]", { a: [1, 2, 3] })).toBe(3);
  });

  it("returns null when out of range or missing (Ruby [] parity)", () => {
    expect(evaluate("a[5]", { a: [1, 2, 3] })).toBeNull();
    expect(evaluate("a['nope']", { a: { key: "value" } })).toBeNull();
  });

  it("accesses object values by string key", () => {
    expect(evaluate("a['key']", { a: { key: "value" } })).toBe("value");
    expect(evaluate("a[k]", { a: { key: "value" }, k: "key" })).toBe("value");
  });

  it("rejects mismatched index types and non-indexable structures", () => {
    expect(() => evaluate("a[1.5]", { a: [1, 2, 3] })).toThrow(TypeMismatchError);
    expect(() => evaluate("a[0]", { a: { key: "value" } })).toThrow(TypeMismatchError);
    expect(() => evaluate("a[0]", { a: 5 })).toThrow(TypeMismatchError);
  });
});

describe("evaluator: function-call dispatch", () => {
  it("evaluates eager defs with evaluated arguments", () => {
    const seen: Value[] = [];
    const spy: FunctionDef = {
      name: "spy",
      returnType: "numeric",
      minArgs: 2,
      maxArgs: 2,
      fn: (...args: Value[]) => {
        seen.push(...args);
        return new Decimal(args.length);
      },
    };
    const node = parseFormula("SPY(1 + 1, 'a')", { registry: registry.withFunction(spy) });
    expect(toExternal(node.value(context()))).toBe(2);
    expect(seen).toHaveLength(2);
    expect((seen[0] as Decimal).toNumber()).toBe(2);
    expect(seen[1]).toBe("a");
  });

  it("passes unevaluated nodes and the context to special forms", () => {
    const node = ast("if(x > 5, big, small)");
    expect(toExternal(node.value(context({ x: 10, big: "B" })))).toBe("B");
    // The untaken branch is never evaluated: `small` may stay unbound.
    expect(node).toBeInstanceOf(FunctionCallNode);
  });

  it("exposes the FunctionDef returnType as the node type", () => {
    const node = ast("if(true, 1, 2)");
    expect(node.type).toBe("any");
  });
});
