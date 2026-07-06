// Public API surface of dentaku. Populated by subsequent issues; see PLAN.md.
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
export {
  type CivilDateTime,
  civilDateTimeFromDate,
  type Duration,
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
