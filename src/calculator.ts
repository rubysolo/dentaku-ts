// Calculator host API (issue 011), per PLAN.md "Host API".
//
// Redesigned from Ruby dentaku's Calculator (v3.5.7 calculator.rb): the Ruby
// evaluate/evaluate! pair becomes evaluate (throws, ADR-0002) / tryEvaluate
// (returns undefined on DentakuError only); the global function registry,
// aliases, global cache flags, block-form store transactions, and the
// array-of-formulas evaluate overload are all removed (PLAN.md "Removals").
// State is per-instance: memory, function registry, and (optional) AST cache.
import type { Binding, EvalContext, Node } from "./ast/node.js";
import { Scope } from "./ast/scope.js";
import { flatten } from "./data/flatten.js";
import { DentakuError, UnboundVariableError } from "./errors.js";
import { defaultFunctionSet } from "./functions/builtins.js";
import { FunctionRegistry, type FunctionSet } from "./functions/registry.js";
import type { FunctionDef } from "./functions/types.js";
import { parseFormula } from "./parser/parser.js";
import { print as printAst } from "./printer.js";
import { type ExternalValue, toExternal, toInternal, type Value, valueType } from "./values.js";

/**
 * A lazily-evaluated variable (Ruby Proc-binding parity): called at most once
 * per lookup, only if the formula actually references the variable.
 */
export type LazyVariable = () => ExternalValue;

/** What a variable may be bound to: an external value or a lazy thunk. */
export type VariableValue = ExternalValue | LazyVariable;

/** Per-call variables / `store()` payload. */
export type Variables = Record<string, VariableValue>;

export interface CalculatorOptions {
  /**
   * Downcase identifiers and memory keys, restoring Ruby dentaku behavior.
   * Default false (ADR-0003.1: identifiers are case-sensitive).
   */
  caseInsensitiveIdentifiers?: boolean;
  /**
   * Enable bare date literals (`2020-01-01`) in formulas, restoring Ruby
   * dentaku behavior. Default false (ADR-0003.5: `2020-1-1` is arithmetic).
   */
  dateLiterals?: boolean;
  /**
   * Flatten nested objects into dotted keys (with intermediates) on `store()`
   * and per-call variables, so `a.basket.of` resolves. Default true.
   */
  nestedData?: boolean;
  /**
   * AST cache, keyed by formula string. `false` (default): no caching.
   * `true`: a private internal Map. Or bring your own Map — you retain
   * ownership, so clearing/evicting the cache is clearing your own Map
   * (there is deliberately no loadCache/clearCache surface).
   */
  astCache?: boolean | Map<string, Node>;
  /**
   * Extra functions available at construction, merged over
   * `defaultFunctionSet` (same-named entries shadow built-ins).
   */
  functions?: FunctionSet;
}

export interface EvaluateOptions {
  /**
   * Skip the outward boundary conversion: results keep their internal types
   * (Decimal instead of number, CivilDateTime instead of Date).
   */
  raw?: boolean;
}

export class Calculator {
  readonly #caseInsensitiveIdentifiers: boolean;
  readonly #dateLiterals: boolean;
  readonly #nestedData: boolean;
  readonly #astCache: Map<string, Node> | undefined;
  readonly #registry: FunctionRegistry;
  /** Lowercased names registered via addFunction/addFunctions (collision check). */
  readonly #instanceFunctionNames = new Set<string>();
  readonly #memory = new Map<string, Binding>();

  constructor(options: CalculatorOptions = {}) {
    this.#caseInsensitiveIdentifiers = options.caseInsensitiveIdentifiers ?? false;
    this.#dateLiterals = options.dateLiterals ?? false;
    this.#nestedData = options.nestedData ?? true;
    const seed =
      options.functions === undefined
        ? defaultFunctionSet
        : defaultFunctionSet.withFunctions(options.functions);
    this.#registry = new FunctionRegistry(seed);
    const cache = options.astCache ?? false;
    this.#astCache = cache === false ? undefined : cache === true ? new Map() : cache;
  }

  // --- evaluation --------------------------------------------------------------

  /**
   * Parses (through the AST cache when enabled), checks that every identifier
   * is bound (UnboundVariableError listing ALL missing variables, checked
   * before any evaluation), evaluates in strict mode, and converts the result
   * outward (`{raw: true}` skips the outward conversion). Throws typed
   * `DentakuError` subclasses (ADR-0002); Ruby's nil-swallowing `evaluate` is
   * `tryEvaluate`.
   */
  evaluate(formula: string, vars?: Variables): ExternalValue;
  evaluate(
    formula: string,
    vars: Variables | undefined,
    options: EvaluateOptions & { raw: true },
  ): Value;
  evaluate(formula: string, vars?: Variables, options?: EvaluateOptions): ExternalValue | Value;
  evaluate(formula: string, vars?: Variables, options?: EvaluateOptions): ExternalValue | Value {
    // Strict mode: enum functions propagate per-item errors (Ruby
    // __evaluation_mode :strict parity for evaluate!).
    return this.#run(formula, vars, { strict: true, raw: options?.raw === true });
  }

  /**
   * Like `evaluate`, but returns undefined when a `DentakuError` subclass is
   * thrown. Anything else (TypeError, RangeError, ...) indicates a bug and
   * propagates (ADR-0002). Runs in permissive mode: enum functions swallow
   * per-item DentakuErrors where Ruby's `:permissive` mode did.
   */
  tryEvaluate(formula: string, vars?: Variables): ExternalValue | undefined;
  tryEvaluate(
    formula: string,
    vars: Variables | undefined,
    options: EvaluateOptions & { raw: true },
  ): Value | undefined;
  tryEvaluate(
    formula: string,
    vars?: Variables,
    options?: EvaluateOptions,
  ): ExternalValue | Value | undefined;
  tryEvaluate(
    formula: string,
    vars?: Variables,
    options?: EvaluateOptions,
  ): ExternalValue | Value | undefined {
    try {
      return this.#run(formula, vars, { strict: false, raw: options?.raw === true });
    } catch (error) {
      if (error instanceof DentakuError) {
        return undefined;
      }
      throw error;
    }
  }

  #run(
    formula: string,
    vars: Variables | undefined,
    mode: { strict: boolean; raw: boolean },
  ): ExternalValue | Value {
    const node = this.ast(formula);
    const ctx = this.#scope(vars, mode.strict);

    // Dependency check first (Ruby evaluate!): list ALL missing variables.
    const unbound = [...new Set(node.dependencies(ctx))];
    if (unbound.length > 0) {
      throw new UnboundVariableError(
        `no value provided for variables: ${unbound.join(", ")}`,
        unbound,
        { formula },
      );
    }

    let result: Value;
    try {
      result = node.value(ctx);
    } catch (error) {
      if (error instanceof DentakuError && error.formula === undefined) {
        error.formula = formula;
      }
      throw error;
    }
    return mode.raw ? result : toExternal(result);
  }

  /**
   * Identifiers that remain unresolved after layering `vars` over memory
   * (deduplicated, in first-occurrence order). Parse failures throw ParseError.
   */
  dependencies(formula: string | Node, vars?: Variables): string[] {
    const node = this.ast(formula);
    return [...new Set(node.dependencies(this.#scope(vars, false)))];
  }

  /**
   * Parses a formula to its AST, through the AST cache when enabled. A `Node`
   * argument is returned unchanged (Ruby parity).
   */
  ast(formula: string | Node): Node {
    if (typeof formula !== "string") {
      return formula;
    }
    const cached = this.#astCache?.get(formula);
    if (cached !== undefined) {
      return cached;
    }
    const node = parseFormula(formula, {
      registry: this.#registry,
      dateLiterals: this.#dateLiterals,
      caseInsensitiveIdentifiers: this.#caseInsensitiveIdentifiers,
    });
    this.#astCache?.set(formula, node);
    return node;
  }

  /** Renders a formula or AST to its canonical string form (see src/printer.ts). */
  print(formula: string | Node): string {
    return printAst(this.ast(formula));
  }

  // --- memory ------------------------------------------------------------------

  /**
   * Stores a variable (or every entry of an object of variables) in memory.
   * Values convert inward via `toInternal` (numbers → Decimal, Dates →
   * CivilDateTime); thunks are kept lazy and convert on call. Nested objects
   * flatten to dotted keys with intermediates when `nestedData` (both the
   * single-key and object forms — Ruby only flattened the object form). Keys
   * are case-normalized per `caseInsensitiveIdentifiers`. Caller objects are
   * never mutated; evaluation never mutates memory.
   */
  store(name: string, value: VariableValue): this;
  store(values: Variables): this;
  store(nameOrObject: string | Variables, value?: VariableValue): this {
    const entries =
      typeof nameOrObject === "string" ? { [nameOrObject]: value ?? null } : nameOrObject;
    for (const [key, binding] of this.#toBindings(entries)) {
      this.#memory.set(key, binding);
    }
    return this;
  }

  /**
   * Stores a named formula: the parsed AST becomes a lazy binding, evaluated
   * (and dependency-tracked) whenever the name is referenced.
   */
  storeFormula(name: string, formula: string): this {
    this.#memory.set(this.#normalizeKey(name), this.ast(formula));
    return this;
  }

  /** Empties memory (stored variables and formulas). */
  clear(): this {
    this.#memory.clear();
    return this;
  }

  // --- functions -----------------------------------------------------------------

  /**
   * Registers a custom function on this calculator only (there is no global
   * registry). The def must be an eager `fn` form — `rawFn` special forms are
   * internal-only and rejected. Registering the same name twice on one
   * calculator is an error; shadowing a built-in (or a constructor-supplied
   * function) is allowed, Ruby parity.
   */
  addFunction(def: FunctionDef): this {
    if (def.rawFn !== undefined) {
      throw new TypeError(
        `Cannot register function '${def.name}': rawFn special forms are internal-only; provide an eager 'fn'`,
      );
    }
    if (def.fn === undefined) {
      throw new TypeError(`Cannot register function '${def.name}': missing 'fn'`);
    }
    const key = def.name.toLowerCase();
    if (this.#instanceFunctionNames.has(key)) {
      throw new Error(`Function '${def.name}' is already registered on this calculator`);
    }
    this.#registry.add(def);
    this.#instanceFunctionNames.add(key);
    return this;
  }

  /** Registers several custom functions; see `addFunction`. */
  addFunctions(defs: Iterable<FunctionDef>): this {
    for (const def of defs) {
      this.addFunction(def);
    }
    return this;
  }

  // --- internals -----------------------------------------------------------------

  #normalizeKey(key: string): string {
    return this.#caseInsensitiveIdentifiers ? key.toLowerCase() : key;
  }

  /**
   * Converts a Variables record into internal bindings: thunks stay lazy
   * (converting on call), plain objects flatten to dotted keys with
   * intermediates when `nestedData` (Ruby FlatHash.from_hash_with_intermediates),
   * keys case-normalize after flattening (Ruby standardize_case order).
   */
  #toBindings(vars: Variables): Map<string, Binding> {
    const out = new Map<string, Binding>();
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === "function") {
        out.set(this.#normalizeKey(key), () => toInternal(value()));
        continue;
      }
      const internal = toInternal(value);
      if (this.#nestedData && valueType(internal) === "object") {
        const nested = flatten({ [key]: internal } as { readonly [k: string]: Value }, {
          intermediates: true,
        });
        for (const [flatKey, flatValue] of nested) {
          out.set(this.#normalizeKey(flatKey), flatValue);
        }
      } else {
        out.set(this.#normalizeKey(key), internal);
      }
    }
    return out;
  }

  /** Memory as the base scope, with per-call vars layered in a child scope. */
  #scope(vars: Variables | undefined, strict: boolean): EvalContext {
    const base = new Scope(this.#memory, { strict });
    if (vars === undefined) {
      return base;
    }
    return base.child(this.#toBindings(vars));
  }
}

/**
 * Module-level convenience: evaluates against a throwaway default Calculator
 * (no shared state of any kind — Ruby's global-registry regret stays dead).
 */
export function evaluate(formula: string, vars?: Variables): ExternalValue;
export function evaluate(
  formula: string,
  vars: Variables | undefined,
  options: EvaluateOptions & { raw: true },
): Value;
export function evaluate(
  formula: string,
  vars?: Variables,
  options?: EvaluateOptions,
): ExternalValue | Value {
  return new Calculator().evaluate(formula, vars, options);
}

/** Module-level convenience mirroring `Calculator#tryEvaluate`; stateless. */
export function tryEvaluate(formula: string, vars?: Variables): ExternalValue | undefined;
export function tryEvaluate(
  formula: string,
  vars: Variables | undefined,
  options: EvaluateOptions & { raw: true },
): Value | undefined;
export function tryEvaluate(
  formula: string,
  vars?: Variables,
  options?: EvaluateOptions,
): ExternalValue | Value | undefined {
  return new Calculator().tryEvaluate(formula, vars, options);
}
