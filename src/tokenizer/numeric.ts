// Numeric literal parsing (Ruby: numeric_parser semantics inside token_scanner.rb).
// Ruby keeps integer literals as Integer and fractional/scientific ones as BigDecimal;
// per ADR-0001 every numeric literal becomes an exact Decimal here.
import { Decimal } from "../decimal.js";

/**
 * Parses a decimal-form numeric literal: integer (`80`), decimal (`1.5`),
 * leading-dot (`.5`), or scientific (`6.02e23`, `.602E+24`, `6e-23`).
 * No underscores or thousands separators.
 */
export function parseNumericLiteral(raw: string): Decimal {
  return new Decimal(raw);
}

/**
 * Parses a hexadecimal literal (`0xFF`, case-insensitive) to an exact Decimal.
 * Goes through BigInt so arbitrarily large literals stay exact.
 */
export function parseHexLiteral(raw: string): Decimal {
  return new Decimal(BigInt(raw.toLowerCase()).toString());
}
