// Nested-object flattening with '.'-separated keys, matching Ruby dentaku's
// FlatHash semantics: `flatten` without intermediates records leaves only
// (arrays and value types are leaves); with intermediates every nested object
// is also stored under its own dotted key. `expand` reverses the mapping.
import { type Value, valueType } from "../values.js";

function isPlainObject(v: Value): v is { readonly [k: string]: Value } {
  return valueType(v) === "object";
}

export interface FlattenOptions {
  intermediates: boolean;
}

export function flatten(
  obj: { readonly [k: string]: Value },
  options: FlattenOptions = { intermediates: false },
): Map<string, Value> {
  const acc = new Map<string, Value>();
  const walk = (o: { readonly [k: string]: Value }, prefix: string): void => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix === "" ? k : `${prefix}.${k}`;
      if (isPlainObject(v)) {
        if (options.intermediates) {
          acc.set(key, v);
        }
        walk(v, key);
      } else {
        acc.set(key, v);
      }
    }
  };
  walk(obj, "");
  return acc;
}

/**
 * Reverses `flatten`: dotted keys become nested objects. Later entries win on
 * conflict (a non-object value in an intermediate position is replaced).
 * Never mutates objects supplied as map values — they are shallow-copied
 * before being descended into.
 */
export function expand(map: ReadonlyMap<string, Value>): { [k: string]: Value } {
  const root: { [k: string]: Value } = {};
  const owned = new Set<object>([root]);

  const descend = (obj: { [k: string]: Value }, level: string): { [k: string]: Value } => {
    const existing = obj[level];
    if (existing !== undefined && isPlainObject(existing)) {
      if (owned.has(existing)) {
        return existing as { [k: string]: Value };
      }
      const copy: { [k: string]: Value } = { ...existing };
      owned.add(copy);
      obj[level] = copy;
      return copy;
    }
    const fresh: { [k: string]: Value } = {};
    owned.add(fresh);
    obj[level] = fresh;
    return fresh;
  };

  for (const [key, value] of map) {
    const levels = key.split(".");
    const last = levels.pop() as string; // split() always yields at least one element
    let cursor = root;
    for (const level of levels) {
      cursor = descend(cursor, level);
    }
    cursor[last] = value;
  }
  return root;
}
