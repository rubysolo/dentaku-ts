// Round-trip property suite (issue 013): for every corpus formula that
// parses, `parse(print(parse(f)))` must be structurally equal to `parse(f)`,
// and printing must be idempotent (`print` of the re-parse reproduces the
// same text).
//
// Corpus entries whose Ruby oracle outcome is ParseError/TokenizerError are
// skipped (they have no AST to round-trip). Eval-time error entries
// (UnboundVariableError, ArgumentError, ZeroDivisionError, MathDomainError)
// still parse and are covered.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccessNode } from "../src/ast/access.js";
import { ArithmeticNode } from "../src/ast/arithmetic.js";
import { ArrayNode } from "../src/ast/array.js";
import { BitwiseNode } from "../src/ast/bitwise.js";
import {
  CaseConditionalNode,
  CaseElseNode,
  CaseNode,
  CaseSwitchVariableNode,
  CaseThenNode,
  CaseWhenNode,
} from "../src/ast/case.js";
import { CombinatorNode } from "../src/ast/combinators.js";
import { ComparatorNode } from "../src/ast/comparators.js";
import { FunctionCallNode } from "../src/ast/function-node.js";
import { GroupingNode } from "../src/ast/grouping.js";
import { IdentifierNode } from "../src/ast/identifier.js";
import { DatetimeNode, LogicalNode, NumericNode, StringNode } from "../src/ast/literal.js";
import { NegationNode } from "../src/ast/negation.js";
import { NilNode } from "../src/ast/nil.js";
import type { Node } from "../src/ast/node.js";
import { PercentageNode } from "../src/ast/percentage.js";
import { FunctionSet } from "../src/functions/registry.js";
import type { FunctionDef, ReturnType } from "../src/functions/types.js";
import { parseFormula } from "../src/parser/parser.js";
import { print } from "../src/printer.js";

// --- Stub function registry -------------------------------------------------
//
// The real packs (issues 007-010) are built in parallel; parsing only needs
// names and arities, so every built-in from PLAN.md's pinned catalog is
// stubbed with Ruby dentaku 3.5.7's min/max parameter counts and a throwing
// fn (the printer and parser never evaluate).

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

const ONE_ARG_MATH = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "exp",
  "log2",
  "log10",
  "sqrt",
  "cbrt",
] as const;

const registry = new FunctionSet([
  // Logic (Ruby lambda splat args parse as 0..variadic).
  stub("if", "any", 3, 3),
  stub("and", "logical", 0, "variadic"),
  stub("or", "logical", 0, "variadic"),
  stub("xor", "logical", 1, "variadic"),
  stub("not", "logical", 1, 1),
  stub("switch", "any", 0, "variadic"),
  // Numeric.
  stub("min", "numeric", 0, "variadic"),
  stub("max", "numeric", 0, "variadic"),
  stub("sum", "numeric", 0, "variadic"),
  stub("avg", "numeric", 0, "variadic"),
  stub("mul", "numeric", 0, "variadic"),
  stub("count", "numeric", 0, "variadic"),
  stub("round", "numeric", 1, 2),
  stub("rounddown", "numeric", 1, 2),
  stub("roundup", "numeric", 1, 2),
  stub("abs", "numeric", 1, 1),
  stub("intercept", "numeric", 0, "variadic"),
  // String.
  stub("left", "string", 2, 2),
  stub("right", "string", 2, 2),
  stub("mid", "string", 3, 3),
  stub("len", "numeric", 1, 1),
  stub("find", "numeric", 2, 2),
  stub("substitute", "string", 3, 3),
  stub("concat", "string", 1, "variadic"),
  stub("contains", "logical", 2, 2),
  // Collection.
  stub("map", "list", 3, 3),
  stub("filter", "list", 3, 3),
  stub("all", "logical", 3, 3),
  stub("any", "logical", 3, 3),
  stub("pluck", "list", 2, 3),
  stub("reduce", "any", 4, 5),
  // Date.
  stub("date", "datetime", 1, 3),
  stub("duration", "duration", 2, 2),
  // Math (float64 pack, issue 010).
  ...ONE_ARG_MATH.map((name) => stub(name, "numeric", 1, 1)),
  stub("log", "numeric", 1, 2),
  stub("atan2", "numeric", 2, 2),
  stub("pow", "numeric", 2, 2),
  stub("hypot", "numeric", 1, "variadic"),
]);

// --- Deep structural AST comparator ------------------------------------------
//
// Equality over node class + operator + children + literal values. Numeric
// literals compare by exact Decimal value (`3.0` ≡ `3`), datetimes by civil
// field equality, function calls by registered name and argument list.

function allEqual(a: readonly Node[], b: readonly Node[]): boolean {
  return a.length === b.length && a.every((node, i) => structurallyEqual(node, b[i] as Node));
}

function structurallyEqual(a: Node, b: Node): boolean {
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a instanceof NumericNode) {
    return a.literal.eq((b as NumericNode).literal);
  }
  if (a instanceof DatetimeNode) {
    return a.literal.equals((b as DatetimeNode).literal);
  }
  if (a instanceof StringNode || a instanceof LogicalNode) {
    return a.literal === (b as StringNode | LogicalNode).literal;
  }
  if (a instanceof IdentifierNode) {
    return a.identifier === (b as IdentifierNode).identifier;
  }
  if (a instanceof NilNode) {
    return true;
  }
  if (
    a instanceof ArithmeticNode ||
    a instanceof BitwiseNode ||
    a instanceof ComparatorNode ||
    a instanceof CombinatorNode
  ) {
    const other = b as typeof a;
    return (
      a.op === other.op &&
      structurallyEqual(a.left, other.left) &&
      structurallyEqual(a.right, other.right)
    );
  }
  if (
    a instanceof NegationNode ||
    a instanceof PercentageNode ||
    a instanceof GroupingNode ||
    a instanceof CaseSwitchVariableNode ||
    a instanceof CaseWhenNode ||
    a instanceof CaseThenNode ||
    a instanceof CaseElseNode
  ) {
    return structurallyEqual(a.node, (b as typeof a).node);
  }
  if (a instanceof ArrayNode) {
    return allEqual(a.elements, (b as ArrayNode).elements);
  }
  if (a instanceof AccessNode) {
    const other = b as AccessNode;
    return (
      structurallyEqual(a.structure, other.structure) && structurallyEqual(a.index, other.index)
    );
  }
  if (a instanceof FunctionCallNode) {
    const other = b as FunctionCallNode;
    return a.name === other.name && allEqual(a.args, other.args);
  }
  if (a instanceof CaseConditionalNode) {
    const other = b as CaseConditionalNode;
    return (
      structurallyEqual(a.when, other.when) && structurallyEqual(a.thenClause, other.thenClause)
    );
  }
  if (a instanceof CaseNode) {
    const other = b as CaseNode;
    if (!structurallyEqual(a.switch, other.switch) || !allEqual(a.conditions, other.conditions)) {
      return false;
    }
    if (a.else === null || other.else === null) {
      return a.else === other.else;
    }
    return structurallyEqual(a.else, other.else);
  }
  throw new TypeError(`structurallyEqual: unknown AST node type ${a.constructor.name}`);
}

// --- Corpus round-trip -------------------------------------------------------

interface CorpusEntry {
  readonly formula: string;
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: string;
  readonly flags?: { readonly dateLiterals?: boolean };
}

const corpus: CorpusEntry[] = JSON.parse(
  readFileSync(new URL("./oracle/corpus.json", import.meta.url), "utf8"),
) as CorpusEntry[];

/** Ruby oracle outcomes with no AST — nothing to round-trip. */
const UNPARSEABLE = new Set(["ParseError", "TokenizerError"]);

/**
 * Corpus formulas that parse but legitimately cannot round-trip, each with a
 * reason. Must stay at ≤5 entries (issue 013 acceptance criteria).
 */
const SKIP: ReadonlyMap<string, string> = new Map<string, string>([
  // (empty — the CASE unparenthesized-switch entry was removed when the
  // parser adopted the gem's v4.0.0-pre fix, commit f16e75a)
]);

interface RoundtripCase {
  readonly formula: string;
  readonly dateLiterals: boolean;
}

const seen = new Set<string>();
const cases: RoundtripCase[] = [];
for (const entry of corpus) {
  if (entry.error !== undefined && UNPARSEABLE.has(entry.error)) {
    continue;
  }
  const dateLiterals = entry.flags?.dateLiterals === true;
  const key = `${dateLiterals ? "D" : "-"}:${entry.formula}`;
  if (seen.has(key)) {
    continue;
  }
  seen.add(key);
  cases.push({ formula: entry.formula, dateLiterals });
}

function title(formula: string): string {
  const flat = formula.replace(/\s+/g, " ").trim();
  return flat === "" ? "<empty formula>" : flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

describe(`round-trip over the oracle corpus (${cases.length} unique formulas)`, () => {
  for (const { formula, dateLiterals } of cases) {
    const skipReason = SKIP.get(formula);
    const spec = skipReason === undefined ? it : it.skip;
    spec(`${title(formula)}${skipReason === undefined ? "" : ` [skip: ${skipReason}]`}`, () => {
      const options = { registry, dateLiterals };
      const ast = parseFormula(formula, options);
      const printed = print(ast);
      const reparsed = parseFormula(printed, options);
      expect(
        structurallyEqual(reparsed, ast),
        `printed form ${JSON.stringify(printed)} re-parsed to a different AST`,
      ).toBe(true);
      // Printing is idempotent: the canonical form prints as itself.
      expect(print(reparsed)).toBe(printed);
    });
  }

  it("keeps the skip-list within the acceptance budget (≤5) and free of stale entries", () => {
    expect(SKIP.size).toBeLessThanOrEqual(5);
    const formulas = new Set(cases.map((c) => c.formula));
    for (const skipped of SKIP.keys()) {
      expect(formulas.has(skipped), `stale skip-list entry: ${skipped}`).toBe(true);
    }
  });
});
