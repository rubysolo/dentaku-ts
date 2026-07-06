// Single point of configuration for decimal.js (ADR-0001).
// All internal code imports Decimal from this module, never from "decimal.js" directly,
// so the configuration below is guaranteed to apply everywhere.
import { Decimal } from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
