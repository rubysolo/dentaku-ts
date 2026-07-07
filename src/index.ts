// Public API surface of dentaku (issue 011; PLAN.md "Host API").

// Power-user surface: parse a formula to an AST without a Calculator.
export type { Node } from "./ast/node.js";
export {
  Calculator,
  type CalculatorOptions,
  type EvaluateOptions,
  evaluate,
  type LazyVariable,
  tryEvaluate,
  type Variables,
  type VariableValue,
} from "./calculator.js";
// Value classes: the CivilDateTime/Duration *classes* (assignable to the
// fields-only interfaces in values.ts) are the public constructors.
export { CivilDateTime, Duration } from "./civil-date.js";
export { Decimal } from "./decimal.js";
export {
  ArgumentCountError,
  CycleError,
  DentakuError,
  type DentakuErrorOptions,
  MathDomainError,
  ParseError,
  type ParseErrorOptions,
  TypeMismatchError,
  UnboundVariableError,
  ZeroDivisionError,
} from "./errors.js";
export { defaultFunctionSet } from "./functions/builtins.js";
export { FunctionRegistry, FunctionSet } from "./functions/registry.js";
export type { FunctionDef, ReturnType } from "./functions/types.js";
export { type ParseFormulaOptions, parseFormula } from "./parser/parser.js";
// Bulk solver types (issue 012): the shapes of Calculator#solve/#trySolve.
export type { BulkFormulas, TrySolveResult } from "./solver/bulk-solver.js";
export {
  civilDateTimeFromDate,
  type DurationUnit,
  type ExternalValue,
  isCivilDateTime,
  isDuration,
  toExternal,
  toInternal,
  type Value,
  type ValueType,
  valueType,
} from "./values.js";
