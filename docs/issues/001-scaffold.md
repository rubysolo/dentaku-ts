# 001: Repo scaffold and toolchain

**Depends on**: nothing · **Blocks**: everything
**Owns**: repo root config files, `.github/`, `src/index.ts` (initial), directory skeleton

## Deliverables

- `git init` with `main` as default branch; commit at end of issue.
- pnpm project: `package.json` with `name: "dentaku"`, `version: "0.0.0"`, `license: "MIT"`, `type: "module"`, `sideEffects: false`, `engines.node: ">=20"`, exports map pointing at `dist/`; single runtime dependency `decimal.js`.
- `tsconfig.json`: strict, `module`/`moduleResolution` NodeNext, ES2022 target, `noUncheckedIndexedAccess`.
- vitest configured (`pnpm test`), tsdown build (`pnpm build`, ESM only + `.d.ts`), Biome (`pnpm lint`), `pnpm typecheck` = `tsc --noEmit`.
- `.github/workflows/ci.yml`: typecheck + lint + test on Node 20/22/24; build job.
- `LICENSE` (MIT, Solomon White), `.gitignore` (node_modules, dist, coverage).
- Directory skeleton per PLAN.md architecture section: empty `src/{tokenizer,parser,ast,functions,solver,data}/`, `tests/oracle/`, `scripts/`.
- `src/index.ts` exporting nothing yet but compiling.

## Acceptance criteria

- Fresh clone: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all succeed (test run may be zero tests but must not error).
- CI workflow is syntactically valid (`act` dry-run or careful review).
- No source code beyond the empty index — this issue is scaffolding only.
