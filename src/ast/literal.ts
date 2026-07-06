// Literal nodes (Ruby ast/literal.rb lineage): numeric, string, logical, datetime.

import type { CivilDateTime } from "../civil-date.js";
import type { Decimal } from "../decimal.js";
import type { ReturnType } from "../functions/types.js";
import type { Value } from "../values.js";
import type { Node } from "./node.js";

abstract class LiteralNode<V extends Value> implements Node {
  readonly literal: V;
  abstract readonly type: ReturnType;

  constructor(literal: V) {
    this.literal = literal;
  }

  value(): V {
    return this.literal;
  }

  dependencies(): string[] {
    return [];
  }
}

export class NumericNode extends LiteralNode<Decimal> {
  readonly type = "numeric";
}

export class StringNode extends LiteralNode<string> {
  readonly type = "string";
}

export class LogicalNode extends LiteralNode<boolean> {
  readonly type = "logical";
}

/**
 * Datetime literal (`dateLiterals` tokenizer option only, ADR-0003.5).
 * Holds the CivilDateTime *class* instance (upgraded from the tokenizer's
 * plain field object via `CivilDateTime.from`) so date arithmetic works.
 */
export class DatetimeNode extends LiteralNode<CivilDateTime> {
  readonly type = "datetime";
}
