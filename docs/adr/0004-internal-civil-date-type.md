# Internal civil-date type; explicit date() construction

Date values are represented by a small internal civil (timezone-free) date-time value type with explicit month arithmetic and end-of-month clamping, mirroring Ruby's `Date#>>` behavior. We do not use JS `Date` (timezone/DST footguns, no civil semantics) or Temporal (not universally shipped; polyfill too heavy for a small feature) — a Temporal adapter can be added at the boundary later. JS `Date` values are accepted/produced only at the API boundary.

Dates originate in formulas only via the `DATE("2026-07-04")` / `DATE(y, m, d)` built-in (new in dentaku-ts) or from context values. Bare date literals (`2020-1-1`) are an opt-in calculator flag (see ADR-0003 tightening 5), and Ruby Dentaku's eval-time string→date coercion in date arithmetic is removed for consistency with the no-coercion posture.
