// FunctionRegistry (per Calculator, mutable) and FunctionSet (immutable, shareable).
// Names are case-insensitive: stored and looked up under their lowercased form.
import type { FunctionDef } from "./types.js";

/**
 * An immutable, shareable collection of FunctionDefs. `withFunction` returns a
 * new set; the receiver is never modified. Iteration yields the defs in
 * insertion order (later defs with the same lowercased name replace earlier ones).
 */
export class FunctionSet implements Iterable<FunctionDef> {
  readonly #defs: ReadonlyMap<string, FunctionDef>;

  constructor(defs: Iterable<FunctionDef> = []) {
    const map = new Map<string, FunctionDef>();
    for (const def of defs) {
      map.set(def.name.toLowerCase(), def);
    }
    this.#defs = map;
  }

  get(name: string): FunctionDef | undefined {
    return this.#defs.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.#defs.has(name.toLowerCase());
  }

  get size(): number {
    return this.#defs.size;
  }

  /** Returns a new FunctionSet with `def` added (or replacing a same-named def). */
  withFunction(def: FunctionDef): FunctionSet {
    return new FunctionSet([...this, def]);
  }

  /** Returns a new FunctionSet with all of `defs` added. */
  withFunctions(defs: Iterable<FunctionDef>): FunctionSet {
    return new FunctionSet([...this, ...defs]);
  }

  [Symbol.iterator](): Iterator<FunctionDef> {
    return this.#defs.values()[Symbol.iterator]();
  }
}

/**
 * The per-Calculator, mutable function registry. Seeded from a FunctionSet;
 * `add` registers or replaces a def under its lowercased name.
 */
export class FunctionRegistry {
  readonly #defs = new Map<string, FunctionDef>();

  constructor(seed?: FunctionSet) {
    if (seed !== undefined) {
      for (const def of seed) {
        this.#defs.set(def.name.toLowerCase(), def);
      }
    }
  }

  get(name: string): FunctionDef | undefined {
    return this.#defs.get(name.toLowerCase());
  }

  add(def: FunctionDef): void {
    this.#defs.set(def.name.toLowerCase(), def);
  }
}
