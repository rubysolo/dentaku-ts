// The `null` literal, and the parse result of an empty token stream (Ruby AST::Nil).
import type { Node } from "./node.js";

export class NilNode implements Node {
  // Ruby parity: Nil reports no static type, so e.g. `null + 5` parses and
  // fails at eval time (TypeMismatchError under ADR-0003.3).
  readonly type = null;

  value(): null {
    return null;
  }

  dependencies(): string[] {
    return [];
  }
}
