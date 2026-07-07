// Shunting-yard parser, ported from Ruby dentaku's parser.rb (issue 006).
//
// Three stacks, exactly like Ruby: `output` (built nodes), `operations`
// (operator/marker entries), and `arities` (argument counts for the enclosing
// function call / array / CASE). CASE assembles innermost-first via marker
// entries and wrapper nodes; function calls are resolved against the registry
// at parse time (undefined-function, min/max arity, and `checkArgs` all fail
// here, not at eval).
import { AccessNode } from "../ast/access.js";
import { ArithmeticNode, type ArithmeticOp } from "../ast/arithmetic.js";
import { ArrayNode } from "../ast/array.js";
import { BitwiseNode, type BitwiseOp } from "../ast/bitwise.js";
import {
  CaseConditionalNode,
  CaseElseNode,
  CaseNode,
  CaseSwitchVariableNode,
  CaseThenNode,
  CaseWhenNode,
} from "../ast/case.js";
import { CombinatorNode } from "../ast/combinators.js";
import { ComparatorNode } from "../ast/comparators.js";
import { FunctionCallNode } from "../ast/function-node.js";
import { IdentifierNode } from "../ast/identifier.js";
import { DatetimeNode, LogicalNode, NumericNode, StringNode } from "../ast/literal.js";
import { NegationNode } from "../ast/negation.js";
import { NilNode } from "../ast/nil.js";
import type { Node } from "../ast/node.js";
import { PercentageNode } from "../ast/percentage.js";
import { CivilDateTime } from "../civil-date.js";
import type { Decimal } from "../decimal.js";
import { ParseError, type ParseErrorOptions } from "../errors.js";
import type { FunctionDef } from "../functions/types.js";
import type { CombinatorValue, ComparatorValue, OperatorValue, Token } from "../tokenizer/token.js";
import { type TokenizerOptions, tokenize } from "../tokenizer/tokenizer.js";
import { isRightAssociative, type OperationName, PRECEDENCE } from "./precedence.js";

/** Anything with a FunctionDef lookup: FunctionRegistry or FunctionSet. */
export interface FunctionLookup {
  get(name: string): FunctionDef | undefined;
}

export interface ParseOptions {
  registry?: FunctionLookup;
  /** Original formula text, attached to ParseErrors for diagnostics. */
  formula?: string;
}

type EntryKind =
  | "op"
  | "grouping"
  | "function"
  | "array"
  | "access"
  | "case"
  | "caseSwitch"
  | "caseWhen"
  | "caseThen"
  | "caseElse"
  | "caseConditional";

interface StackEntry {
  kind: EntryKind;
  /** Human name for error messages. */
  name: string;
  /** Fixed operand count; null means "use the comma-derived count" (Ruby arity nil). */
  arity: number | null;
  minParams: number;
  maxParams: number;
  /** Operator precedence/associativity; only present on kind "op". */
  precedence: number;
  rightAssociative: boolean;
  build: (args: Node[]) => Node;
  def?: FunctionDef;
}

function entry(
  kind: EntryKind,
  name: string,
  shape: { arity: number | null; min?: number; max?: number },
  build: (args: Node[]) => Node,
): StackEntry {
  return {
    kind,
    name,
    arity: shape.arity,
    minParams: shape.min ?? shape.arity ?? 0,
    maxParams: shape.max ?? shape.arity ?? Number.POSITIVE_INFINITY,
    precedence: 0,
    rightAssociative: false,
    build,
  };
}

function opEntry(op: OperationName, name: string, build: (args: Node[]) => Node): StackEntry {
  const arity = op === "negate" || op === "percentage" ? 1 : 2;
  return {
    ...entry("op", name, { arity }, build),
    kind: "op",
    precedence: PRECEDENCE[op],
    rightAssociative: isRightAssociative(op),
  };
}

const ARITHMETIC_OPS: ReadonlySet<OperatorValue> = new Set([
  "add",
  "subtract",
  "multiply",
  "divide",
  "mod",
  "pow",
]);

const BITWISE_OPS: ReadonlySet<OperatorValue> = new Set([
  "bitor",
  "bitand",
  "shiftleft",
  "shiftright",
]);

/**
 * Ruby Modulo.resolve_class: a `%` token is postfix percentage when the next
 * token is nothing, an operator, or a closing paren; otherwise binary modulo.
 */
function isPercentage(lookahead: Token | undefined): boolean {
  if (lookahead === undefined) {
    return true;
  }
  return (
    lookahead.category === "operator" ||
    (lookahead.category === "grouping" && lookahead.value === "close")
  );
}

function operationEntry(token: Token, lookahead: Token | undefined): StackEntry {
  if (token.category === "operator") {
    const op = token.value as OperatorValue;
    if (op === "negate") {
      return opEntry("negate", "negation", ([node]) => new NegationNode(node as Node));
    }
    if (op === "mod" && isPercentage(lookahead)) {
      return opEntry("percentage", "percentage", ([node]) => new PercentageNode(node as Node));
    }
    if (BITWISE_OPS.has(op)) {
      const bitOp = op as BitwiseOp;
      return opEntry(bitOp, token.raw, ([l, r]) => new BitwiseNode(bitOp, l as Node, r as Node));
    }
    if (ARITHMETIC_OPS.has(op)) {
      const arithOp = op as ArithmeticOp;
      return opEntry(
        arithOp,
        token.raw,
        ([l, r]) => new ArithmeticNode(arithOp, l as Node, r as Node),
      );
    }
  }
  if (token.category === "comparator") {
    const op = token.value as ComparatorValue;
    return opEntry(op, token.raw, ([l, r]) => new ComparatorNode(op, l as Node, r as Node));
  }
  if (token.category === "combinator") {
    const op = token.value as CombinatorValue;
    return opEntry(op, op, ([l, r]) => new CombinatorNode(op, l as Node, r as Node));
  }
  throw new TypeError(`not an operation token: ${token.category} ${String(token.value)}`);
}

class Parser {
  readonly #input: readonly Token[];
  readonly #output: Node[] = [];
  readonly #operations: StackEntry[] = [];
  readonly #arities: number[] = [];
  readonly #registry: FunctionLookup | undefined;
  readonly #formula: string | undefined;
  readonly #skipIndices = new Set<number>();

  constructor(tokens: readonly Token[], options: ParseOptions) {
    this.#input = tokens;
    this.#registry = options.registry;
    this.#formula = options.formula;
  }

  parse(): Node {
    if (this.#input.length === 0) {
      return new NilNode();
    }

    for (let i = 0; i < this.#input.length; i++) {
      if (this.#skipIndices.has(i)) {
        continue;
      }
      const token = this.#input[i] as Token;
      const lookahead = this.#input[i + 1];
      this.#processToken(token, lookahead, i);
    }

    while (this.#operations.length > 0) {
      this.#consume();
    }

    if (this.#output.length !== 1) {
      this.#fail("Invalid statement", "invalid-statement");
    }
    return this.#output[0] as Node;
  }

  #fail(message: string, reason: string, position?: number): never {
    const options: ParseErrorOptions = {};
    if (this.#formula !== undefined) {
      options.formula = this.#formula;
    }
    if (position !== undefined) {
      options.position = position;
    }
    throw new ParseError(message, reason, options);
  }

  #top(): StackEntry | undefined {
    return this.#operations[this.#operations.length - 1];
  }

  /**
   * Ruby Parser#consume: pop one operations entry and build its node from the
   * output stack. `count` is the comma-derived argument count for entries with
   * no fixed arity (function calls, arrays, CASE).
   */
  #consume(count = 2): void {
    const op = this.#operations.pop();
    if (op === undefined) {
      this.#fail("Invalid statement", "invalid-statement");
    }

    const outputSize = this.#output.length;
    const argsSize = op.arity ?? count;
    const minSize = op.arity ?? op.minParams;
    const maxSize = op.arity ?? op.maxParams;
    const expected =
      minSize === maxSize
        ? String(minSize)
        : `${minSize}..${Number.isFinite(maxSize) ? maxSize : ""}`;

    if (outputSize < minSize || argsSize < minSize) {
      this.#fail(
        `${op.name} has too few operands (given ${Math.min(outputSize, argsSize)}, expected ${expected})`,
        "too-few-operands",
      );
    }
    if ((outputSize > maxSize && this.#operations.length === 0) || argsSize > maxSize) {
      this.#fail(
        `${op.name} has too many operands (given ${Math.max(outputSize, argsSize)}, expected ${expected})`,
        "too-many-operands",
      );
    }

    let args: Node[] = [];
    if (op.kind === "array" && this.#output.length === 0) {
      // Ruby special case: empty array literal '{}'.
      this.#output.push(new ArrayNode([]));
    } else {
      if (outputSize < argsSize) {
        this.#fail("Invalid statement", "invalid-statement");
      }
      args = this.#output.splice(this.#output.length - argsSize, argsSize);
      this.#output.push(op.build(args));
    }

    // Parse-time validation hook (Ruby function callback).
    if (op.kind === "function") {
      op.def?.checkArgs?.(args);
    }
  }

  #consumeUntil(targets: readonly EntryKind[]): void {
    while (this.#operations.length > 0) {
      const top = this.#top() as StackEntry;
      if (targets.includes(top.kind)) {
        return;
      }
      this.#consume();
    }
  }

  #processToken(token: Token, lookahead: Token | undefined, index: number): void {
    switch (token.category) {
      case "datetime":
        // The tokenizer emits plain CivilDateTime field objects; upgrade to
        // the class so date arithmetic works (issue 004 `from` path).
        this.#output.push(new DatetimeNode(CivilDateTime.from(token.value as CivilDateTime)));
        break;
      case "numeric":
        this.#output.push(new NumericNode(token.value as Decimal));
        break;
      case "logical":
        this.#output.push(new LogicalNode(token.value as boolean));
        break;
      case "string":
        this.#output.push(new StringNode(token.value as string));
        break;
      case "identifier":
        this.#output.push(new IdentifierNode(token.value as string));
        break;
      case "null":
        this.#output.push(new NilNode());
        break;
      case "operator":
      case "comparator":
      case "combinator":
        this.#handleOperation(token, lookahead);
        break;
      case "function":
        this.#handleFunction(token);
        break;
      case "case":
        this.#handleCase(token);
        break;
      case "access":
        this.#handleAccess(token);
        break;
      case "array":
        this.#handleArray(token);
        break;
      case "grouping":
        this.#handleGrouping(token, lookahead, index);
        break;
      default:
        this.#fail(
          `Not implemented for tokens of category ${token.category}`,
          "not-implemented-token-category",
          token.position,
        );
    }
  }

  #handleOperation(token: Token, lookahead: Token | undefined): void {
    const op = operationEntry(token, lookahead);
    for (;;) {
      const top = this.#top();
      if (top === undefined || top.kind !== "op") {
        break;
      }
      const shouldPop = op.rightAssociative
        ? op.precedence < top.precedence
        : op.precedence <= top.precedence;
      if (!shouldPop) {
        break;
      }
      this.#consume();
    }
    this.#operations.push(op);
  }

  #handleFunction(token: Token): void {
    const name = token.value as string;
    const def = this.#registry?.get(name);
    if (def === undefined) {
      this.#fail(`Undefined function ${name}`, "undefined-function", token.position);
    }

    // Arity defaults follow the FunctionDef contract: fn.length when min/max
    // are omitted; rawFn-only defs default to variadic.
    const fnLength = def.fn?.length;
    const min = def.minArgs ?? fnLength ?? 0;
    const maxRaw = def.maxArgs ?? fnLength ?? "variadic";
    const max = maxRaw === "variadic" ? Number.POSITIVE_INFINITY : maxRaw;

    this.#arities.push(0);
    // Function entries have no fixed arity (Ruby: class-registered functions
    // report nil arity): the comma-derived count is what min/max validate, so
    // e.g. `IF(1, 2, 3, 4)` fails with too-many-operands.
    this.#operations.push({
      ...entry(
        "function",
        name,
        { arity: null, min, max },
        (args) => new FunctionCallNode(def, args),
      ),
      kind: "function",
      def,
    });
  }

  #handleAccess(token: Token): void {
    if (token.value === "lbracket") {
      this.#operations.push(
        entry(
          "access",
          "access",
          { arity: 2 },
          ([structure, index]) => new AccessNode(structure as Node, index as Node),
        ),
      );
      return;
    }
    // rbracket
    this.#consumeUntil(["access"]);
    if (this.#top()?.kind !== "access") {
      this.#fail("Unbalanced bracket", "unbalanced-bracket", token.position);
    }
    this.#consume();
  }

  #handleArray(token: Token): void {
    if (token.value === "arrayStart") {
      this.#operations.push(
        entry("array", "array", { arity: null, min: 0 }, (args) => new ArrayNode(args)),
      );
      this.#arities.push(0);
      return;
    }
    // arrayEnd
    this.#consumeUntil(["array"]);
    if (this.#top()?.kind !== "array") {
      this.#fail("Unbalanced bracket", "unbalanced-bracket", token.position);
    }
    this.#consume((this.#arities.pop() ?? 0) + 1);
  }

  #handleGrouping(token: Token, lookahead: Token | undefined, index: number): void {
    switch (token.value) {
      case "open":
        if (lookahead?.category === "grouping" && lookahead.value === "close") {
          // Empty parens (zero-argument function call): skip the close token
          // and consume the pending function entry with a count of 0.
          this.#skipIndices.add(index + 1);
          this.#arities.pop();
          this.#consume(0);
        } else {
          this.#operations.push(
            entry("grouping", "grouping", { arity: null, min: 0 }, () => {
              this.#fail("Invalid statement", "invalid-statement");
            }),
          );
        }
        break;

      case "close": {
        this.#consumeUntil(["grouping"]);
        const lparen = this.#operations.pop();
        if (lparen === undefined || lparen.kind !== "grouping") {
          this.#fail("Unbalanced parenthesis", "unbalanced-parenthesis", token.position);
        }
        if (this.#top()?.kind === "function") {
          this.#consume((this.#arities.pop() ?? 0) + 1);
        }
        break;
      }

      case "comma":
        if (this.#arities.length === 0) {
          this.#fail("Invalid statement", "invalid-statement", token.position);
        }
        this.#bumpArity();
        this.#consumeUntil(["grouping", "array"]);
        break;

      default:
        this.#fail(
          `Unknown grouping token ${String(token.value)}`,
          "unknown-grouping-token",
          token.position,
        );
    }
  }

  /**
   * CASE assembly (Ruby handle_case): operates on the innermost CASE on the
   * operations stack; WHEN/THEN pairs collapse into conditionals as the
   * following keyword arrives.
   */
  #handleCase(token: Token): void {
    // Index of the entry immediately above the innermost CASE marker.
    let caseIndex = -1;
    for (let i = this.#operations.length - 1; i >= 0; i--) {
      if ((this.#operations[i] as StackEntry).kind === "case") {
        caseIndex = i;
        break;
      }
    }
    const above = this.#operations[caseIndex + 1];

    switch (token.value) {
      case "case":
        this.#operations.push(
          entry("case", "CASE", { arity: null, min: 2 }, (args) => new CaseNode(args)),
        );
        this.#arities.push(0);
        break;

      case "end":
        if (above?.kind === "caseThen") {
          this.#consumeUntil(["case"]);
          this.#pushCaseConditional();
          this.#consume(2);
          this.#bumpArity();
        } else if (above?.kind === "caseElse") {
          this.#consumeUntil(["case"]);
          this.#bumpArity();
        }
        if (this.#top()?.kind !== "case") {
          this.#fail("Unprocessed token end", "unprocessed-token", token.position);
        }
        this.#consume((this.#arities.pop() ?? 0) + 1);
        break;

      case "when":
        if (above?.kind === "caseThen") {
          // Close out the previous WHEN/THEN pair.
          this.#consumeUntil(["caseWhen", "case"]);
          this.#pushCaseConditional();
          this.#consume(2);
          this.#bumpArity();
        } else if (above === undefined || above.kind === "op") {
          // First WHEN: fold any operators pending from an unparenthesized
          // switch expression (CASE a % 5 WHEN ...), then finalize the
          // switch variable.
          this.#consumeUntil(["case"]);
          this.#operations.push(
            entry(
              "caseSwitch",
              "CASE switch",
              { arity: 1 },
              ([node]) => new CaseSwitchVariableNode(node as Node),
            ),
          );
          this.#consume();
        }
        this.#operations.push(
          entry("caseWhen", "WHEN", { arity: 1 }, ([node]) => new CaseWhenNode(node as Node)),
        );
        break;

      case "then":
        if (above?.kind === "caseWhen") {
          this.#consumeUntil(["caseThen", "case"]);
        }
        this.#operations.push(
          entry("caseThen", "THEN", { arity: 1 }, ([node]) => new CaseThenNode(node as Node)),
        );
        break;

      case "else":
        if (above?.kind === "caseThen") {
          this.#consumeUntil(["case"]);
          this.#pushCaseConditional();
          this.#consume(2);
          this.#bumpArity();
        }
        this.#operations.push(
          entry("caseElse", "ELSE", { arity: 1 }, ([node]) => new CaseElseNode(node as Node)),
        );
        break;

      default:
        this.#fail(
          `Unknown case token ${String(token.value)}`,
          "unknown-case-token",
          token.position,
        );
    }
  }

  #pushCaseConditional(): void {
    this.#operations.push(
      entry(
        "caseConditional",
        "WHEN/THEN",
        { arity: 2 },
        ([whenNode, thenNode]) => new CaseConditionalNode(whenNode as Node, thenNode as Node),
      ),
    );
  }

  /** Ruby `arities[-1] += 1` (comma and finished WHEN/THEN conditionals). */
  #bumpArity(): void {
    const last = this.#arities.length - 1;
    if (last < 0) {
      this.#fail("Invalid statement", "invalid-statement");
    }
    this.#arities[last] = (this.#arities[last] ?? 0) + 1;
  }
}

/** Parses a token stream into an AST. An empty stream parses to NilNode. */
export function parse(tokens: readonly Token[], options: ParseOptions = {}): Node {
  return new Parser(tokens, options).parse();
}

export interface ParseFormulaOptions extends TokenizerOptions {
  registry?: FunctionLookup;
}

/** Convenience composition of tokenize + parse (tests and issues 011/013). */
export function parseFormula(formula: string, options: ParseFormulaOptions = {}): Node {
  const { registry, ...tokenizerOptions } = options;
  const parseOptions: ParseOptions = { formula };
  if (registry !== undefined) {
    parseOptions.registry = registry;
  }
  return parse(tokenize(formula, tokenizerOptions), parseOptions);
}
