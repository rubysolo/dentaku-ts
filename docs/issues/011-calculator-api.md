# 011: Calculator API

**Depends on**: 006, 007, 008, 009, 010 · **Blocks**: 012
**Owns**: `src/calculator.ts`, `src/index.ts` (final export surface)

## Deliverables

Per PLAN.md "Host API" (signatures are the contract — copy exactly):

- `new Calculator(options?)` with `caseInsensitiveIdentifiers` (default false), `dateLiterals` (default false), `nestedData` (default true), `astCache` (default false; `true` = internal Map, or bring-your-own Map), `functions?: FunctionSet` merged over `defaultFunctionSet`.
- `evaluate(formula, vars?)` — tokenize/parse (through cache when enabled), check unbound deps first (`UnboundVariableError` listing all missing, Ruby message shape: `no value provided for variables: a, b`), evaluate, `toExternal` the result. `evaluate(formula, vars, {raw: true})` skips outward conversion.
- `tryEvaluate(...)` — catches **only `DentakuError`** → undefined; anything else propagates (bug).
- `store(name, value)` / `store(object)` — converts inward via `toInternal`, flattens nested objects (with intermediates) when `nestedData`; keys case-normalized per options. `storeFormula(name, formula)` stores the parsed AST as a lazy binding. `clear()`. No block-transaction form (per-call vars replace it).
- `addFunction(def)` / `addFunctions(defs)` — instance registry only; reject `rawFn` in the public path (special forms are internal); validate name collisions with an explicit error.
- `dependencies(formula, vars?)` → `string[]` of identifiers unresolved after memory + vars.
- `ast(formula)` → `Node` (public, feeds printer and power users); accepts a Node and returns it unchanged.
- Module-level `evaluate`/`tryEvaluate` conveniences in `index.ts`: construct a throwaway default Calculator per call — **zero module-level mutable state**.
- Per-call vars layer over memory without mutating it; caller-supplied objects are never mutated (Ruby's identifier-cache mutation regret stays dead).

## Acceptance criteria

- Port `spec/calculator_spec.rb` (the big one) and `spec/external_function_spec.rb`, ADR-annotating: bang-method mapping (`evaluate!` cases → `evaluate`, `evaluate` nil-cases → `tryEvaluate`), case-sensitivity deltas (ADR-0003.1), coercion deltas (ADR-0003.3), truthiness deltas (ADR-0003.2), date-literal cases run with `dateLiterals: true` (ADR-0003.5). Skip Ruby-only surface (block-form store, `evaluate` over arrays, global registry cases) with a comment.
- AST cache test: same formula twice parses once (spy on tokenizer), different vars still re-evaluate.
- `pnpm build` output: importing `dentaku` gives `Calculator`, `evaluate`, `tryEvaluate`, error classes, types.
- Green per working agreement.
