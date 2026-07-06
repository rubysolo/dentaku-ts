// Value equality for comparators and CASE matching (issue 006).

import { CivilDateTime } from "../civil-date.js";
import { Decimal } from "../decimal.js";
import { TypeMismatchError } from "../errors.js";
import { isCivilDateTime, type Value, type ValueType, valueType } from "../values.js";

function sameTypeEquals(l: Value, r: Value, kind: ValueType, loose: boolean): boolean {
  switch (kind) {
    case "null":
      return true;
    case "logical":
    case "string":
      return l === r;
    case "numeric":
      return (l as Decimal).eq(r as Decimal);
    case "datetime":
      return CivilDateTime.from(l as CivilDateTime).equals(r as CivilDateTime);
    case "duration": {
      const a = l as { value: number; unit: string };
      const b = r as { value: number; unit: string };
      return a.value === b.value && a.unit === b.unit;
    }
    case "array": {
      const a = l as Value[];
      const b = r as Value[];
      return a.length === b.length && a.every((el, i) => equals(el, b[i] as Value, loose));
    }
    case "object": {
      const a = l as { readonly [k: string]: Value };
      const b = r as { readonly [k: string]: Value };
      const keys = Object.keys(a);
      return (
        keys.length === Object.keys(b).length &&
        keys.every((k) => Object.hasOwn(b, k) && equals(a[k] as Value, b[k] as Value, loose))
      );
    }
  }
}

function equals(l: Value, r: Value, loose: boolean): boolean {
  const lt = valueType(l);
  const rt = valueType(r);
  if (lt !== rt) {
    if (loose) {
      return false;
    }
    // ADR-0003.3: no coercion between operand types — mixed-type (in)equality
    // is a type error, where Ruby's `==` answered false.
    throw new TypeMismatchError(`cannot compare ${lt} with ${rt}`);
  }
  return sameTypeEquals(l, r, lt, loose);
}

/**
 * Typed-pair equality for `=`/`==`/`!=`/`<>`: both sides must have the same
 * type (deep for arrays/objects), otherwise TypeMismatchError (ADR-0003.3).
 */
export function strictEquals(l: Value, r: Value): boolean {
  return equals(l, r, false);
}

/**
 * Non-throwing equality: mixed-type pairs answer false (Ruby `==` parity).
 * Used by CASE when-matching (and issue 007's `switch`).
 */
export function looseEquals(l: Value, r: Value): boolean {
  return equals(l, r, true);
}

/** Ordering for `<` `<=` `>` `>=`: numeric, string (lexicographic), datetime pairs only. */
export function compareOrdered(l: Value, r: Value): -1 | 0 | 1 {
  if (l instanceof Decimal && r instanceof Decimal) {
    return l.cmp(r) as -1 | 0 | 1;
  }
  if (typeof l === "string" && typeof r === "string") {
    if (l < r) {
      return -1;
    }
    return l > r ? 1 : 0;
  }
  if (isCivilDateTime(l) && isCivilDateTime(r)) {
    return CivilDateTime.from(l).compare(r);
  }
  // ADR-0003.3: no string→number coercion in comparators (Ruby coerced numeric
  // strings), and unordered types (boolean, null, arrays, ...) cannot be ranked.
  throw new TypeMismatchError(`cannot order ${valueType(l)} against ${valueType(r)}`);
}
