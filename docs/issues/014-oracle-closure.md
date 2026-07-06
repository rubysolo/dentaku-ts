# 014: Oracle closure

**Depends on**: 002, 011, 012, 013 (everything functional) · **Blocks**: 015
**Owns**: `tests/oracle.spec.ts`, `tests/oracle/allowlist.json` (completion)

## Context

The final honesty gate (PLAN.md "Verification protocol", CONTEXT.md "Oracle corpus" / "Divergence allowlist"). After this issue, every difference from Ruby dentaku 3.5.7 is either fixed or enumerated with an ADR citation.

## Deliverables

- `tests/oracle.spec.ts`: for each corpus entry — build a Calculator (honoring entry `flags`, e.g. `dateLiterals`), run `evaluate(formula, vars)` expecting the encoded result (decimal strings compared via Decimal equality, not float; datetimes via ISO; arrays deep), or expecting the mapped error class (Ruby→TS error mapping table lives in this file: `Dentaku::UnboundVariableError→UnboundVariableError`, `Dentaku::ZeroDivisionError→ZeroDivisionError`, `Dentaku::ParseError/TokenizerError→ParseError`, `Dentaku::ArgumentError→TypeMismatchError|ArgumentCountError` (either accepted), `Dentaku::MathDomainError→MathDomainError`, `TSort::Cyclic→CycleError`).
- Allowlist handling: entries listed in `allowlist.json` assert the **TS-expected** behavior instead; a listed entry whose Ruby and TS behavior no longer differ fails the suite as *stale*.
- Work loop: run the corpus, triage every mismatch — (a) bug in TS → fix in the owning module (this issue may edit any `src/` file, it runs alone after all waves), (b) genuine tightening consequence → allowlist entry with `reason: ADR-0003.n | ADR-0004`, (c) corpus-generation artifact → fix scripts/corpus and note it.
- Final allowlist review: every entry's reason must trace to a specific ADR clause; group-count summary appended to `tests/oracle/README.md` (e.g. "17 entries: 6×ADR-0003.2, 4×ADR-0003.3, …").

## Acceptance criteria

- Oracle suite green: zero unlisted mismatches, zero stale allowlist entries.
- Allowlist total is within the planning estimate (≲5% of corpus, ~≤20 entries); if it materially exceeds that, stop and report before proceeding — that signals a semantic drift beyond the agreed tightenings.
- Full repo green per working agreement.
