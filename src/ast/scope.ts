// Layered EvalContext implementation (issue 006).
//
// A Scope is a map of bindings over an optional parent context. Child scopes
// are O(1) to create (they hold a reference, not a copy), which is what issue
// 009's enum functions need for per-element lambda bindings.
import type { Value } from "../values.js";
import { type Binding, type EvalContext, isNode } from "./node.js";

/** Resolves a raw binding to a Value: nodes evaluate recursively, thunks are called. */
export function resolveBinding(binding: Binding, ctx: EvalContext): Value {
  if (typeof binding === "function") {
    return binding();
  }
  if (isNode(binding)) {
    return binding.value(ctx);
  }
  return binding;
}

export interface ScopeOptions {
  parent?: EvalContext;
  /** Strict error mode for enum functions (issue 009). Default false. */
  strict?: boolean;
}

export class Scope implements EvalContext {
  readonly #bindings: ReadonlyMap<string, Binding>;
  readonly #parent: EvalContext | undefined;
  readonly strict: boolean;

  constructor(bindings?: Iterable<readonly [string, Binding]>, options: ScopeOptions = {}) {
    this.#bindings = new Map(bindings ?? []);
    this.#parent = options.parent;
    this.strict = options.strict ?? options.parent?.strict === true;
  }

  /** Builds a Scope from a plain record of (already-internal) bindings. */
  static of(bindings: Record<string, Binding>, options: ScopeOptions = {}): Scope {
    return new Scope(Object.entries(bindings), options);
  }

  /** Raw layered lookup: own bindings first, then the parent chain. */
  lookup(name: string): Binding | undefined {
    if (this.#bindings.has(name)) {
      return this.#bindings.get(name);
    }
    const parent = this.#parent;
    if (parent === undefined) {
      return undefined;
    }
    return parent.lookup !== undefined ? parent.lookup(name) : parent.get(name);
  }

  /** Resolved lookup: `Node` bindings evaluate (against this scope), thunks are called. */
  get(name: string): Value | undefined {
    const binding = this.lookup(name);
    return binding === undefined ? undefined : resolveBinding(binding, this);
  }

  /** O(1) child scope; inherits `strict`. */
  child(bindings: ReadonlyMap<string, Binding>): Scope {
    return new Scope(bindings, { parent: this, strict: this.strict });
  }
}

/**
 * Layers `bindings` over any EvalContext, using the context's own `child`
 * when it provides one (issue 009 entry point).
 */
export function childScope(
  parent: EvalContext,
  bindings: ReadonlyMap<string, Binding>,
): EvalContext {
  return parent.child !== undefined ? parent.child(bindings) : new Scope(bindings, { parent });
}
