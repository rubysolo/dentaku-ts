// Tokenizer entry point, ported from Ruby dentaku's tokenizer.rb:
// strip comments, run the ordered scanner table until the input is exhausted
// (first match wins), track paren/bracket/brace balance, and report token
// positions as offsets into the ORIGINAL input (comment stripping is undone
// via an offset map).
//
// Host-level features of the Ruby tokenizer that are removed by design (PLAN.md
// "Removals"): global function aliases (`replace_aliases`) and the mutable
// global scanner registry.
import { ParseError } from "../errors.js";
import { buildScanners, type TokenizerOptions } from "./scanners.js";
import type { Token } from "./token.js";

export type { TokenizerOptions } from "./scanners.js";

// Ruby: input.gsub(/\/\*[^*]*\*+(?:[^*\/][^*]*\*+)*\//, '')
const COMMENT_REGEX = /\/\*[^*]*\*+(?:[^*/][^*]*\*+)*\//g;

interface StrippedInput {
  stripped: string;
  /** Maps an offset in `stripped` back to the offset in the original input. */
  toOriginal: (pos: number) => number;
}

function stripComments(input: string): StrippedInput {
  // Each entry: from stripped offset `at` onward, `delta` comment characters
  // were removed before that point.
  const breaks: Array<{ at: number; delta: number }> = [];
  let stripped = "";
  let consumed = 0;
  let removed = 0;
  for (const m of input.matchAll(COMMENT_REGEX)) {
    stripped += input.slice(consumed, m.index);
    removed += m[0].length;
    breaks.push({ at: stripped.length, delta: removed });
    consumed = m.index + m[0].length;
  }
  stripped += input.slice(consumed);
  const toOriginal = (pos: number): number => {
    let delta = 0;
    for (const b of breaks) {
      if (b.at > pos) {
        break;
      }
      delta = b.delta;
    }
    return pos + delta;
  };
  return { stripped, toOriginal };
}

interface BalanceKind {
  reason: string;
  noun: string;
}

const PAREN: BalanceKind = { reason: "unbalanced-parenthesis", noun: "parentheses" };
const BRACKET: BalanceKind = { reason: "unbalanced-bracket", noun: "brackets" };
const BRACE: BalanceKind = { reason: "unbalanced-brace", noun: "braces" };

/**
 * Tokenizes a formula into the Token stream consumed by the parser (issue 006).
 *
 * Comments are stripped first; token `position`s always refer to offsets in the
 * original `formula`. Throws `ParseError` with reason `invalid-token` when no
 * scanner matches, and reason `unbalanced-parenthesis`/`unbalanced-bracket`/
 * `unbalanced-brace` on grouping imbalance.
 */
export function tokenize(formula: string, options: TokenizerOptions = {}): Token[] {
  const { stripped, toOriginal } = stripComments(formula);
  const scanners = buildScanners(options);
  const tokens: Token[] = [];
  // Positions (original offsets) of currently-unmatched openers, per kind.
  const openParens: number[] = [];
  const openBrackets: number[] = [];
  const openBraces: number[] = [];
  let lastToken: Token | null = null;
  let pos = 0;

  const fail = (message: string, reason: string, position: number): never => {
    throw new ParseError(message, reason, { formula, position });
  };

  const trackClose = (kind: BalanceKind, stack: number[], position: number): void => {
    if (stack.length === 0) {
      fail(`too many closing ${kind.noun}`, kind.reason, position);
    }
    stack.pop();
  };

  while (pos < stripped.length) {
    let matched = false;
    for (const scanner of scanners) {
      const result = scanner(stripped, pos, lastToken);
      if (result === null) {
        continue;
      }
      matched = true;
      for (const token of result.tokens) {
        token.position = toOriginal(token.position);
        if (token.category === "grouping" && token.value === "open") {
          openParens.push(token.position);
        } else if (token.category === "grouping" && token.value === "close") {
          trackClose(PAREN, openParens, token.position);
        } else if (token.category === "access" && token.value === "lbracket") {
          openBrackets.push(token.position);
        } else if (token.category === "access" && token.value === "rbracket") {
          trackClose(BRACKET, openBrackets, token.position);
        } else if (token.category === "array" && token.value === "arrayStart") {
          openBraces.push(token.position);
        } else if (token.category === "array" && token.value === "arrayEnd") {
          trackClose(BRACE, openBraces, token.position);
        }
        tokens.push(token);
        lastToken = token;
      }
      pos += result.length;
      break;
    }
    if (!matched) {
      fail(`parse error at: '${stripped.slice(pos)}'`, "invalid-token", toOriginal(pos));
    }
  }

  for (const [kind, stack] of [
    [PAREN, openParens],
    [BRACKET, openBrackets],
    [BRACE, openBraces],
  ] as const) {
    const first = stack[0];
    if (first !== undefined) {
      fail(`too many opening ${kind.noun}`, kind.reason, first);
    }
  }

  return tokens;
}
