// Error taxonomy per PLAN.md. `tryEvaluate`/`trySolve` catch exactly DentakuError
// subclasses; anything else (TypeError, RangeError, ...) indicates a bug and propagates.

export interface DentakuErrorOptions {
  /** The formula text being processed when the error occurred. */
  formula?: string;
  /** The result key being solved when the error occurred (bulk solve only). */
  key?: string;
}

export abstract class DentakuError extends Error {
  formula?: string;
  key?: string;

  constructor(message: string, options?: DentakuErrorOptions) {
    super(message);
    this.name = "DentakuError";
    if (options?.formula !== undefined) {
      this.formula = options.formula;
    }
    if (options?.key !== undefined) {
      this.key = options.key;
    }
  }
}

export interface ParseErrorOptions extends DentakuErrorOptions {
  position?: number;
}

/** Tokenizer and parser failures. */
export class ParseError extends DentakuError {
  readonly reason: string;
  readonly position?: number;

  constructor(message: string, reason: string, options?: ParseErrorOptions) {
    super(message, options);
    this.name = "ParseError";
    this.reason = reason;
    if (options?.position !== undefined) {
      this.position = options.position;
    }
  }
}

/** One or more identifiers in the formula have no binding. */
export class UnboundVariableError extends DentakuError {
  readonly unboundVariables: readonly string[];

  constructor(message: string, unboundVariables: readonly string[], options?: DentakuErrorOptions) {
    super(message, options);
    this.name = "UnboundVariableError";
    this.unboundVariables = [...unboundVariables];
  }
}

/** An operand or argument has the wrong type (ADR-0003 strictness errors land here). */
export class TypeMismatchError extends DentakuError {
  constructor(message: string, options?: DentakuErrorOptions) {
    super(message, options);
    this.name = "TypeMismatchError";
  }
}

/** A function was called with too few or too many arguments. */
export class ArgumentCountError extends DentakuError {
  constructor(message: string, options?: DentakuErrorOptions) {
    super(message, options);
    this.name = "ArgumentCountError";
  }
}

/** Division (or modulo) by zero. */
export class ZeroDivisionError extends DentakuError {
  constructor(message: string, options?: DentakuErrorOptions) {
    super(message, options);
    this.name = "ZeroDivisionError";
  }
}

/** A math function was evaluated outside its domain (e.g. sqrt(-1)). */
export class MathDomainError extends DentakuError {
  constructor(message: string, options?: DentakuErrorOptions) {
    super(message, options);
    this.name = "MathDomainError";
  }
}

/** The bulk solver detected a dependency cycle. */
export class CycleError extends DentakuError {
  readonly cycle: readonly string[];

  constructor(message: string, cycle: readonly string[], options?: DentakuErrorOptions) {
    super(message, options);
    this.name = "CycleError";
    this.cycle = [...cycle];
  }
}
