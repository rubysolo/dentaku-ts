# 015: Docs and release polish

**Depends on**: 014 · **Blocks**: nothing (final)
**Owns**: `README.md`, `CHANGELOG.md`, `package.json` metadata, `docs/` additions

## Deliverables

- `README.md`: successor pitch (what dentaku is, safety posture for untrusted formulas); quick start (`evaluate`, Calculator, store, custom functions); operator/function reference tables (mirror the Ruby README's structure — it's good); **"Migrating from Ruby dentaku"** section: the five tightenings with before/after formula examples and the option flags that restore old behavior (`caseInsensitiveIdentifiers`, `dateLiterals`), the `date()` function, `evaluate/tryEvaluate` + `solve/trySolve` mapping from `evaluate/evaluate!`/`solve/solve!`, omitted math functions list; AST-cache and performance note; link to `docs/adr/`.
- `CHANGELOG.md`: `0.1.0` entry summarizing the successor relationship.
- `package.json`: description, keywords (formula, parser, evaluator, calculator, excel, dentaku, expression), `repository`/`bugs`/`homepage` (GitHub URL — leave `rubysolo/dentaku-ts` placeholder if remote not yet created), `files: ["dist"]`, author Solomon White.
- `pnpm publish --dry-run` clean; verify the tarball contains only `dist`, README, LICENSE, package.json.
- Doc-accuracy pass: every formula example in the README executes correctly via a `tests/readme.spec.ts` that extracts and runs fenced examples (cheap insurance for a docs-heavy release).

## Acceptance criteria

- README examples all pass in `tests/readme.spec.ts`.
- Dry-run publish output reviewed and pasted into the closing note.
- Full repo green; version left at `0.1.0` unpublished — actual `npm publish` is a human action.
