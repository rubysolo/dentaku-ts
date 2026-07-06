// The default function set every Calculator is seeded with. Packs (issues
// 007-010) fill only their own file; this barrel never needs editing.
import { collectionFunctions } from "./collection.js";
import { dateFunctions } from "./date.js";
import { logicFunctions } from "./logic.js";
import { mathFunctions } from "./math.js";
import { numericFunctions } from "./numeric.js";
import { FunctionSet } from "./registry.js";
import { stringFunctions } from "./string.js";

export const defaultFunctionSet: FunctionSet = new FunctionSet([
  ...logicFunctions,
  ...numericFunctions,
  ...stringFunctions,
  ...collectionFunctions,
  ...dateFunctions,
  ...mathFunctions,
]);
