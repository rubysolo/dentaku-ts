// Logic function pack: if, and, or, xor, not, switch (issue 007).
//
// Ported from Ruby dentaku v3.5.7 lib/dentaku/ast/functions/{if,and,or,xor,
// not,switch}.rb with the ADR-0003.2 tightening: conditionals and combinator
// functions take boolean operands only — no Ruby truthiness where `0` and `""`
// are true. One Ruby-parity exception, preserved deliberately: AND/OR/XOR
// accepted nil alongside booleans (nil counts as false), so `null` remains
// admissible there. `if` and `not` never accepted nil in a useful way under
// strict booleans, so they reject it.
import { looseEquals } from "../ast/equality.js";
import type { EvalContext, Node } from "../ast/node.js";
import { requireBoolean, unionDependencies } from "../ast/operands.js";
import { ArgumentCountError, DentakuError, TypeMismatchError } from "../errors.js";
import { type Value, valueType } from "../values.js";
import type { FunctionDef } from "./types.js";

/** Empty context for dependency probing without a scope (Ruby `context = {}`). */
const EMPTY_CONTEXT: EvalContext = { get: () => undefined };

/**
 * AND/OR/XOR argument admission (Ruby parity): boolean passes through, null
 * counts as false, anything else is a type error (Ruby raised
 * Dentaku::ArgumentError :incompatible_type; our taxonomy splits that into
 * TypeMismatchError).
 */
function logicalOrNull(name: string, v: Value): boolean {
  if (typeof v === "boolean") {
    return v;
  }
  if (v === null) {
    return false;
  }
  // ADR-0003.2 lineage: AND()/OR() were already strict in Ruby; no truthiness.
  throw new TypeMismatchError(
    `${name}() requires arguments to be logical expressions, got ${valueType(v)}`,
  );
}

/**
 * Ruby registered AND/OR as splat lambdas (parse-time min_param_count 0), so
 * the ≥1-arg rule fires at eval time as Dentaku::ArgumentError — hence
 * minArgs: 0 plus this eval-time ArgumentCountError, not a parse-time check.
 * (XOR is class-registered with min_param_count 1 in Ruby, so it *does* fail
 * at parse time; see its def below.)
 */
function booleanArgs(name: string, args: Value[]): boolean[] {
  if (args.length === 0) {
    throw new ArgumentCountError(`${name}() requires at least one argument`);
  }
  return args.map((arg) => logicalOrNull(name, arg));
}

const ifDef: FunctionDef = {
  name: "if",
  // Ruby If#type delegated to the taken branch's type; a FunctionCallNode's
  // type is fixed per def, and `any` is admissible everywhere (operands.ts).
  returnType: "any",
  minArgs: 3,
  maxArgs: 3,
  // Special form: evaluate the predicate, then ONLY the taken branch.
  rawFn: (argNodes: Node[], ctx: EvalContext): Value => {
    const [predicate, left, right] = argNodes as [Node, Node, Node];
    // ADR-0003.2: the predicate must be boolean (Ruby accepted any truthy value).
    return requireBoolean(predicate.value(ctx), "IF") ? left.value(ctx) : right.value(ctx);
  },
  /**
   * Ruby-parity short-circuit dependency reporting (ast/functions/if.rb):
   * when the predicate can be evaluated against the given context, only the
   * taken branch's dependencies matter (unioned with the predicate's own —
   * relevant when the predicate is satisfied via formula bindings); when it
   * cannot (unbound variables, type errors, ...), fall back to the union of
   * all three arguments, exactly like Ruby's rescue clause.
   */
  dependencies: (argNodes: Node[], ctx?: EvalContext): string[] => {
    const [predicate, left, right] = argNodes as [Node, Node, Node];
    try {
      const taken = requireBoolean(predicate.value(ctx ?? EMPTY_CONTEXT), "IF") ? left : right;
      return unionDependencies([predicate, taken], ctx);
    } catch (error) {
      // Ruby rescues its Dentaku error hierarchy only; bugs still propagate.
      if (error instanceof DentakuError) {
        return unionDependencies(argNodes, ctx);
      }
      throw error;
    }
  },
};

const andDef: FunctionDef = {
  name: "and",
  returnType: "logical",
  minArgs: 0, // ≥1 enforced at eval time as ArgumentCountError (Ruby parity).
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => booleanArgs("AND", args).every((v) => v),
};

const orDef: FunctionDef = {
  name: "or",
  returnType: "logical",
  minArgs: 0, // ≥1 enforced at eval time as ArgumentCountError (Ruby parity).
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => booleanArgs("OR", args).some((v) => v),
};

const xorDef: FunctionDef = {
  name: "xor",
  returnType: "logical",
  // Ruby's Xor is class-registered with min_param_count 1: `XOR()` fails at
  // parse time (Dentaku::ParseError), unlike AND()/OR().
  minArgs: 1,
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => booleanArgs("XOR", args).filter((v) => v).length === 1,
};

const notDef: FunctionDef = {
  name: "not",
  returnType: "logical",
  // ADR-0003.2: Ruby's NOT used bare truthiness (`!logical`, so NOT(0) was
  // false and NOT(null) was true); here the argument must be boolean.
  fn: (logical: Value): Value => !requireBoolean(logical, "NOT"),
};

const switchDef: FunctionDef = {
  name: "switch",
  // Ruby registered switch as :logical, but its result is whichever result
  // arm matched; `any` reflects that (and is admissible everywhere).
  returnType: "any",
  minArgs: 1,
  maxArgs: "variadic",
  fn: (...args: Value[]): Value => {
    const [value, ...rest] = args as [Value, ...Value[]];
    const hasDefault = rest.length % 2 === 1;
    const fallback: Value = hasDefault ? (rest[rest.length - 1] as Value) : null;
    const pairCount = hasDefault ? rest.length - 1 : rest.length;
    for (let i = 0; i < pairCount; i += 2) {
      // looseEquals: Ruby `==` parity — mixed-type pairs answer false, they
      // are not an error here (unlike the `=` comparator, ADR-0003.3).
      if (looseEquals(rest[i] as Value, value)) {
        return rest[i + 1] as Value;
      }
    }
    return fallback;
  },
};

export const logicFunctions: FunctionDef[] = [ifDef, andDef, orDef, xorDef, notDef, switchDef];
