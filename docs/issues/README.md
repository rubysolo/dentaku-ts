# dentaku-ts implementation issues

Decomposition of [PLAN.md](../../PLAN.md) into issues executable by parallel AFK agents. Each issue is self-contained: it names the files it owns, the contracts it must honor, and its acceptance criteria. Read `CONTEXT.md` and `docs/adr/` before starting any issue; PLAN.md is the spec of record and issues do not re-litigate it.

## Dependency graph

```
001 scaffold
 ├── 002 oracle-corpus          (parallel with 003)
 └── 003 foundation
      ├── 004 civil-dates       (parallel with 005)
      ├── 005 tokenizer         (parallel with 004)
      │    └── 006 parser-evaluator-core   (also needs 003, 004)
      │         ├── 007 functions-logic-numeric   ┐
      │         ├── 008 functions-string          │ all four packs + printer
      │         ├── 009 functions-collection      │ run in parallel
      │         ├── 010 functions-date-math       │
      │         └── 013 printer-roundtrip         ┘
      │              (007–010) → 011 calculator-api
      │                           └── 012 solver
      │                                └── 014 oracle-closure   (also needs 002, 013)
      │                                     └── 015 docs-release
```

## Wave schedule for parallel agents

| Wave | Issues | Parallelism |
|---|---|---|
| 1 | 001 | 1 agent |
| 2 | 002, 003 | 2 agents |
| 3 | 004, 005 | 2 agents |
| 4 | 006 | 1 agent (the big one) |
| 5 | 007, 008, 009, 010, 013 | 5 agents |
| 6 | 011 | 1 agent |
| 7 | 012 | 1 agent |
| 8 | 014 | 1 agent |
| 9 | 015 | 1 agent |

## Working agreement for every agent

- **File ownership is exclusive.** Only edit files listed under your issue's "Owns". You may *add* test files under `tests/` matching your issue's area. If you believe a file outside your ownership needs a change, stop and report — do not edit it.
- **Contracts are frozen.** Types/signatures marked as contracts in issue 003 and 006 may be *implemented against*, never altered. A contract change requires human sign-off.
- **Green means**: `pnpm typecheck && pnpm lint && pnpm test` all pass, including tests from previously merged issues.
- **Every deviation from Ruby dentaku behavior** in a test must carry a comment citing the ADR tightening (`// ADR-0003.2: strict booleans`). A deviation you cannot cite is a bug in your implementation.
- **Reference implementation**: clone `https://github.com/rubysolo/dentaku` (v3.5.7) into a scratch directory when Ruby-behavior questions arise. Its `spec/` directory is the behavioral ground truth for everything not covered by an ADR.
- Work on a branch named `issue/NNN-slug`; one merge per issue, in wave order.
