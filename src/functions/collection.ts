// Collection function pack: map, filter, all, any, pluck, reduce (issue 009).
//
// These are the identifier-lambda special forms, ported from Ruby dentaku
// v3.5.7 lib/dentaku/ast/functions/{enum,map,filter,all,any,pluck,reduce}.rb.
// All are rawFn special forms: the body expression is evaluated per element in
// a child scope where the bound identifier names the element (and, for object
// elements, its flattened dotted keys with intermediates are layered under
// `ident.…`, Ruby's FlatHash.from_hash_with_intermediates merge).
//
// ADR-0003.2 tightening: `filter`/`all`/`any` bodies must produce booleans
// (TypeMismatchError otherwise). Ruby used truthiness and, for all/any,
// swallowed per-item errors to a falsy nil in permissive mode; with strict
// booleans that swallow is meaningless, so per-item errors in filter/all/any
// always propagate (permissive callers catch them at the tryEvaluate
// boundary). `map` keeps Ruby's permissive per-item swallow-to-null.
import { IdentifierNode } from "../ast/identifier.js";
import type { EvalContext, Node } from "../ast/node.js";
import { requireBoolean, unionDependencies } from "../ast/operands.js";
import { childScope } from "../ast/scope.js";
import { flatten } from "../data/flatten.js";
import { DentakuError, ParseError, TypeMismatchError } from "../errors.js";
import { type Value, valueType } from "../values.js";
import type { FunctionDef } from "./types.js";

// --- shared helpers ----------------------------------------------------------

/** Ruby `Array()` semantics: null → [], arrays pass through, scalars wrap. */
function toArray(v: Value): Value[] {
  if (v === null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse-time identifier validation (Ruby Enum#validate_identifier), wired into
 * `checkArgs` so the parser raises at parse time. Also re-checked by each
 * `rawFn` so manually constructed FunctionCallNodes fail the same way Ruby's
 * `initialize` does.
 */
function requireIdentifier(
  node: Node | undefined,
  fn: string,
  position: string,
): asserts node is IdentifierNode {
  if (!(node instanceof IdentifierNode)) {
    throw new ParseError(
      `${fn}() requires ${position} argument to be an identifier`,
      "node-invalid",
    );
  }
}

/**
 * Evaluates `expression` in a child scope binding each entry of `bindings` —
 * and, for object values, their flattened dotted keys with intermediates
 * (Ruby FlatHash.from_hash_with_intermediates), so `map(users, u, u.age)` works.
 */
function evalBody(
  expression: Node,
  ctx: EvalContext,
  bindings: { readonly [k: string]: Value },
): Value {
  return expression.value(childScope(ctx, flatten(bindings, { intermediates: true })));
}

/**
 * Ruby Enum#mapped_value (`map` only): a per-item error yields null unless the
 * context is strict (`__evaluation_mode` parity). Only DentakuError is
 * swallowed — anything else indicates a bug and propagates (see errors.ts).
 */
function mappedValue(
  expression: Node,
  ctx: EvalContext,
  bindings: { readonly [k: string]: Value },
): Value {
  try {
    return evalBody(expression, ctx, bindings);
  } catch (e) {
    if (ctx.strict === true || !(e instanceof DentakuError)) {
      throw e;
    }
    return null;
  }
}

/** Drops deps equal to a bound identifier or under its dotted prefix (Ruby Enum#dependencies reject). */
function subtractBound(deps: readonly string[], bound: readonly string[]): string[] {
  return deps.filter((dep) => !bound.some((id) => dep === id || dep.startsWith(`${id}.`)));
}

function dedupe(deps: readonly string[]): string[] {
  return [...new Set(deps)];
}

/**
 * Ruby Enum#dependencies: the collection's deps plus the body's deps minus the
 * bound identifier and its dotted prefixes. Shared by map/filter/all/any and
 * pluck (whose "body" is the optional default expression and whose bound
 * identifier is the pluck key).
 */
function enumDependencies(argNodes: Node[], ctx?: EvalContext): string[] {
  const [collection, ident, expression] = argNodes;
  if (collection === undefined || !(ident instanceof IdentifierNode)) {
    return unionDependencies(argNodes, ctx);
  }
  const expressionDeps =
    expression === undefined ? [] : subtractBound(expression.dependencies(ctx), [ident.identifier]);
  return dedupe([...collection.dependencies(ctx), ...expressionDeps]);
}

/** Ruby Reduce#dependencies: both memo and item identifiers are subtracted; initial-value deps included. */
function reduceDependencies(argNodes: Node[], ctx?: EvalContext): string[] {
  const [collection, memoIdent, itemIdent, expression, initial] = argNodes;
  if (
    collection === undefined ||
    expression === undefined ||
    !(memoIdent instanceof IdentifierNode) ||
    !(itemIdent instanceof IdentifierNode)
  ) {
    return unionDependencies(argNodes, ctx);
  }
  return dedupe([
    ...collection.dependencies(ctx),
    ...subtractBound(expression.dependencies(ctx), [memoIdent.identifier, itemIdent.identifier]),
    ...(initial === undefined ? [] : initial.dependencies(ctx)),
  ]);
}

// --- function definitions ------------------------------------------------------

const map: FunctionDef = {
  name: "map",
  returnType: "list",
  minArgs: 3,
  maxArgs: 3,
  checkArgs: (argNodes) => requireIdentifier(argNodes[1], "MAP", "second"),
  dependencies: enumDependencies,
  rawFn: (argNodes, ctx) => {
    const [collectionNode, identNode, expression] = argNodes as [Node, Node, Node];
    requireIdentifier(identNode, "MAP", "second");
    const ident = identNode.identifier;
    return toArray(collectionNode.value(ctx)).map((item) =>
      mappedValue(expression, ctx, { [ident]: item }),
    );
  },
};

const filter: FunctionDef = {
  name: "filter",
  returnType: "list",
  minArgs: 3,
  maxArgs: 3,
  checkArgs: (argNodes) => requireIdentifier(argNodes[1], "FILTER", "second"),
  dependencies: enumDependencies,
  rawFn: (argNodes, ctx) => {
    const [collectionNode, identNode, expression] = argNodes as [Node, Node, Node];
    requireIdentifier(identNode, "FILTER", "second");
    const ident = identNode.identifier;
    return toArray(collectionNode.value(ctx)).filter((item) =>
      // ADR-0003.2: filter bodies must produce booleans (Ruby selected by truthiness).
      requireBoolean(evalBody(expression, ctx, { [ident]: item }), "FILTER()"),
    );
  },
};

const all: FunctionDef = {
  name: "all",
  returnType: "logical",
  minArgs: 3,
  maxArgs: 3,
  checkArgs: (argNodes) => requireIdentifier(argNodes[1], "ALL", "second"),
  dependencies: enumDependencies,
  rawFn: (argNodes, ctx) => {
    const [collectionNode, identNode, expression] = argNodes as [Node, Node, Node];
    requireIdentifier(identNode, "ALL", "second");
    const ident = identNode.identifier;
    for (const item of toArray(collectionNode.value(ctx))) {
      // ADR-0003.2: strict boolean bodies; per-item errors propagate (no Ruby
      // permissive swallow-to-nil, which strict booleans would reject anyway).
      if (!requireBoolean(evalBody(expression, ctx, { [ident]: item }), "ALL()")) {
        return false;
      }
    }
    return true;
  },
};

const any: FunctionDef = {
  name: "any",
  returnType: "logical",
  minArgs: 3,
  maxArgs: 3,
  checkArgs: (argNodes) => requireIdentifier(argNodes[1], "ANY", "second"),
  dependencies: enumDependencies,
  rawFn: (argNodes, ctx) => {
    const [collectionNode, identNode, expression] = argNodes as [Node, Node, Node];
    requireIdentifier(identNode, "ANY", "second");
    const ident = identNode.identifier;
    for (const item of toArray(collectionNode.value(ctx))) {
      // ADR-0003.2: strict boolean bodies; per-item errors propagate.
      if (requireBoolean(evalBody(expression, ctx, { [ident]: item }), "ANY()")) {
        return true;
      }
    }
    return false;
  },
};

const pluck: FunctionDef = {
  name: "pluck",
  returnType: "list",
  minArgs: 2,
  maxArgs: 3,
  checkArgs: (argNodes) => requireIdentifier(argNodes[1], "PLUCK", "second"),
  dependencies: enumDependencies,
  rawFn: (argNodes, ctx) => {
    const [collectionNode, keyNode, defaultNode] = argNodes;
    requireIdentifier(keyNode, "PLUCK", "second");
    const collection = toArray((collectionNode as Node).value(ctx));
    if (!collection.every((element) => valueType(element) === "object")) {
      throw new TypeMismatchError("PLUCK() requires first argument to be an array of hashes");
    }
    const key = keyNode.identifier;
    // Ruby evaluates the default inside the per-item fetch; evaluating it once
    // for a non-empty collection is observationally identical in the Value model.
    const fallback: Value =
      collection.length > 0 && defaultNode !== undefined ? defaultNode.value(ctx) : null;
    return collection.map((element) => {
      const obj = element as { readonly [k: string]: Value };
      return Object.hasOwn(obj, key) ? (obj[key] as Value) : fallback;
    });
  },
};

const reduce: FunctionDef = {
  name: "reduce",
  returnType: "any",
  minArgs: 4,
  maxArgs: 5,
  checkArgs: (argNodes) => {
    requireIdentifier(argNodes[1], "REDUCE", "second");
    requireIdentifier(argNodes[2], "REDUCE", "third");
  },
  dependencies: reduceDependencies,
  rawFn: (argNodes, ctx) => {
    const [collectionNode, memoNode, itemNode, expression, initialNode] = argNodes;
    requireIdentifier(memoNode, "REDUCE", "second");
    requireIdentifier(itemNode, "REDUCE", "third");
    const collection = toArray((collectionNode as Node).value(ctx));
    // Ruby `collection.reduce(initial_value)` with a nil initial starts the
    // memo at nil (not at the first element) — initial defaults to null.
    let memo: Value = initialNode === undefined ? null : initialNode.value(ctx);
    for (const item of collection) {
      memo = evalBody(expression as Node, ctx, {
        [memoNode.identifier]: memo,
        [itemNode.identifier]: item,
      });
    }
    return memo;
  },
};

export const collectionFunctions: FunctionDef[] = [map, filter, all, any, pluck, reduce];
