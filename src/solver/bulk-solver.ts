// Bulk expression solver (issue 012; Ruby bulk_expression_solver.rb lineage).
//
// Successor changes over Ruby (PLAN.md "Additions" / "Host API"):
// - `trySolve` reports a typed per-key error map instead of `:undefined`.
// - A dependency cycle fails only its members and their downstream dependents
//   with CycleError; independent keys still solve (Ruby abandoned the batch).
// - Results are written to a scratch scope layered over calculator memory;
//   solving never mutates the calculator instance.
import type { Binding, EvalContext, Node } from "../ast/node.js";
import { childScope } from "../ast/scope.js";
import { expand } from "../data/flatten.js";
import { CycleError, DentakuError, UnboundVariableError } from "../errors.js";
import { type ExternalValue, toExternal, type Value } from "../values.js";
import { inBatchDependencies, sortDependencies } from "./dependency-graph.js";

/**
 * A batch of named formulas. Nested records flatten to '.'-separated keys
 * (Ruby FlatHash parity): `{a: {b: "1 + 1"}}` solves the key `"a.b"` and the
 * result expands back to `{a: {b: 2}}`. Leaves are formula strings or
 * pre-parsed ASTs (Ruby parity: expressions may be AST nodes).
 */
export type BulkFormulas = {
  readonly [key: string]: string | Node | BulkFormulas;
};

/** Result of `Calculator#trySolve`. Every input key lands in exactly one map. */
export interface TrySolveResult {
  /** Successful results, nested keys re-expanded. */
  values: { [key: string]: ExternalValue };
  /** Failed keys (flattened '.'-separated form) → the causing error. */
  errors: { [key: string]: DentakuError };
}

/**
 * The minimal calculator surface the solver needs. Built by the private
 * `Calculator#solverHost` so the solver can share the calculator's parser,
 * key normalization, and memory+vars scope without reaching into privates.
 */
export interface SolverHost {
  /** Parse a formula through the calculator (AST cache included); Nodes pass through. */
  ast(formula: string | Node): Node;
  /** Case-normalize a key exactly like the calculator normalizes identifiers. */
  normalizeKey(key: string): string;
  /**
   * Calculator memory with per-call vars layered in, carrying the solve
   * mode's strictness (solve → strict, trySolve → permissive, mirroring
   * evaluate/tryEvaluate). Scratch results are layered over this; the
   * underlying memory is never written.
   */
  readonly baseContext: EvalContext;
}

/** One flattened batch entry, keyed by its normalized name. */
interface Entry {
  /** All original (pre-normalization) flattened keys mapping to this entry. */
  originals: string[];
  /** Parsed formula; undefined when parsing failed (see `error`). */
  node: Node | undefined;
  /** The formula source, when the input was a string (error tagging). */
  formula: string | undefined;
  /** Parse failure, reported at this key's slot in evaluation order. */
  error: DentakuError | undefined;
}

function isLeaf(value: string | Node | BulkFormulas): value is string | Node {
  if (typeof value === "string") {
    return true;
  }
  return (
    typeof (value as Node).value === "function" &&
    typeof (value as Node).dependencies === "function"
  );
}

/** Flattens nested batch keys to '.'-separated form (Ruby FlatHash.from_hash). */
function flattenBatch(batch: BulkFormulas): Map<string, string | Node> {
  const acc = new Map<string, string | Node>();
  const walk = (record: BulkFormulas, prefix: string): void => {
    for (const [key, value] of Object.entries(record)) {
      const flatKey = prefix === "" ? key : `${prefix}.${key}`;
      if (isLeaf(value)) {
        acc.set(flatKey, value);
      } else {
        walk(value, flatKey);
      }
    }
  };
  walk(batch, "");
  return acc;
}

function joinCycle(members: readonly string[]): string {
  return [...members, members[0] as string].join(" → ");
}

/**
 * Solves the batch strictly: every key evaluates in dependency order (facts —
 * keys with no in-batch dependencies — first, in insertion order) and the
 * first failure is thrown, tagged with the failing result `key`. Cycle
 * members and their downstream dependents fail with CycleError at their
 * position in the order.
 */
export function solveBulk(host: SolverHost, batch: BulkFormulas): { [key: string]: ExternalValue } {
  return run(host, batch, { strict: true }).values;
}

/**
 * Solves the batch permissively: failures are collected per key instead of
 * thrown, and independent keys still solve (successor improvement over Ruby's
 * abandon-all-on-cycle; PLAN.md "Additions").
 */
export function trySolveBulk(host: SolverHost, batch: BulkFormulas): TrySolveResult {
  return run(host, batch, { strict: false });
}

function run(host: SolverHost, batch: BulkFormulas, mode: { strict: boolean }): TrySolveResult {
  // Flatten and normalize keys. Later duplicates (same normalized key, e.g.
  // "A" and "a" under caseInsensitiveIdentifiers) overwrite the formula but
  // keep the first key's position — Ruby Hash#transform_keys parity — and
  // every original key receives the shared outcome.
  const entries = new Map<string, Entry>();
  for (const [original, formula] of flattenBatch(batch)) {
    const normalized = host.normalizeKey(original);
    let entry = entries.get(normalized);
    if (entry === undefined) {
      entry = { originals: [], node: undefined, formula: undefined, error: undefined };
      entries.set(normalized, entry);
    }
    entry.originals.push(original);
    entry.formula = typeof formula === "string" ? formula : undefined;
    entry.node = undefined;
    entry.error = undefined;
    try {
      entry.node = host.ast(formula);
    } catch (error) {
      if (!(error instanceof DentakuError)) {
        throw error;
      }
      entry.error = error;
    }
  }

  // Dependency edges, scoped to in-batch keys; unparseable keys contribute no
  // edges (dependents on them fall through to UnboundVariableError).
  const batchKeys = new Set(entries.keys());
  const edges = new Map<string, string[]>();
  for (const [key, entry] of entries) {
    edges.set(
      key,
      entry.node === undefined ? [] : inBatchDependencies(entry.node, host.baseContext, batchKeys),
    );
  }
  const graph = sortDependencies(edges);

  // Facts (no in-batch dependencies) first, in insertion order; then the
  // remaining keys in dependency order.
  const isFact = (key: string): boolean => (edges.get(key) as string[]).length === 0;
  const sequence = [
    ...[...edges.keys()].filter(isFact),
    ...graph.order.filter((key) => !isFact(key)),
  ];

  const scratch = new Map<string, Binding>();
  const rawValues = new Map<string, Value>();
  const errors = new Map<string, DentakuError>();
  const originalsOf = (key: string): string[] => (entries.get(key) as Entry).originals;

  const fail = (key: string, error: DentakuError): void => {
    const entry = entries.get(key) as Entry;
    if (error.key === undefined) {
      error.key = entry.originals[0] as string;
    }
    if (error.formula === undefined && entry.formula !== undefined) {
      error.formula = entry.formula;
    }
    if (mode.strict) {
      throw error;
    }
    errors.set(key, error);
  };

  for (const key of sequence) {
    const entry = entries.get(key) as Entry;
    if (entry.error !== undefined) {
      fail(key, entry.error);
      continue;
    }
    const cycle = graph.cycles.get(key);
    if (cycle !== undefined) {
      const members = cycle.flatMap(originalsOf);
      fail(
        key,
        new CycleError(`formula dependencies form a cycle: ${joinCycle(members)}`, members),
      );
      continue;
    }
    const blockedBy = graph.blocked.get(key);
    if (blockedBy !== undefined) {
      const members = blockedBy.flatMap(originalsOf);
      fail(
        key,
        new CycleError(`formula depends on a dependency cycle: ${joinCycle(members)}`, members),
      );
      continue;
    }
    const node = entry.node as Node;
    const ctx = childScope(host.baseContext, scratch);
    try {
      // Mirror Calculator#run: list ALL missing variables before evaluating.
      const unbound = [...new Set(node.dependencies(ctx))];
      if (unbound.length > 0) {
        throw new UnboundVariableError(
          `no value provided for variables: ${unbound.join(", ")}`,
          unbound,
        );
      }
      const value = node.value(ctx);
      scratch.set(key, value);
      rawValues.set(key, value);
    } catch (error) {
      if (!(error instanceof DentakuError)) {
        throw error;
      }
      fail(key, error);
    }
  }

  // Re-key by original (flattened) names in input order, expand dotted value
  // keys back to nested records, and convert values outward.
  const valuesByOriginal = new Map<string, Value>();
  const errorsByOriginal: { [key: string]: DentakuError } = {};
  for (const [key, entry] of entries) {
    for (const original of entry.originals) {
      if (rawValues.has(key)) {
        valuesByOriginal.set(original, rawValues.get(key) as Value);
      } else {
        errorsByOriginal[original] = errors.get(key) as DentakuError;
      }
    }
  }
  const values = toExternal(expand(valuesByOriginal)) as { [key: string]: ExternalValue };
  return { values, errors: errorsByOriginal };
}
