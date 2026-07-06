# 006: Parser, AST, and evaluator core

**Depends on**: 003, 004, 005 · **Blocks**: 007–013
**Owns**: `src/parser/`, `src/ast/` (including fleshing out the node.ts stub — signatures frozen)

The largest issue; it lands the whole expression pipeline minus built-in functions.

## Deliverables

### Parser (`src/parser/`)
- Shunting yard with output stack, operator stack, and arity stack, per Ruby `parser.rb`: function-call handling (registry lookup at parse time → `ParseError` reason `undefined-function` if unknown; arity checked against FunctionDef min/max → `ArgumentCountError` semantics surface as ParseError reason `too-few-operands`/`too-many-operands`), array literals `{…}` incl. empty, access `a[expr]`, grouping/comma, CASE assembly (`CASE switch WHEN c THEN r … [ELSE d] END`, innermost-first via marker classes, validation errors mirror Ruby's), empty-parens function calls.
- Precedence table per PLAN.md (the successor table: negation 50 right-assoc; pow/percentage 40; mul/div/mod 30; add/sub 20; shifts 15; bitand 12; bitor 11; comparators 5; and 2; or 1). `^` left-associative. **ADR-0003.4** governs rows 15/12/11.
- Percentage/modulo lookahead exactly as Ruby: `mod` token resolves to postfix Percentage when next token is nothing, an operator, or a close-grouping.
- `parse(tokens, {registry}): Node`; empty token list → `NilNode`.

### AST nodes (`src/ast/`)
Node interface as frozen in 003. `EvalContext` implementation: layered lookup (per-call vars over calculator memory), holds flattened maps, exposes `strict` flag for enum-function error mode (used by issue 009).

Semantics (each with `value(ctx)`, `dependencies(ctx)`, `type`):
- Literals (numeric/string/logical/datetime/nil), Identifier (unbound → `UnboundVariableError`; a stored value that is itself a `Node` — from `storeFormula` — evaluates recursively; a function-valued binding is called lazily), ArrayNode, Access (arrays: integer index; objects: string key; out-of-range → null, matching Ruby `[]`), Grouping (transparent).
- Arithmetic (add/sub/mul/div/mod/pow/percentage/negation): operands must be numeric (Decimal) — **ADR-0003.3: no string coercion; throw TypeMismatchError**. Datetime special cases: `datetime + numeric` (days), `datetime + duration`, `datetime - datetime` (Decimal days), `datetime - duration/numeric` — delegate to `applyDuration`/`diffDays` from 004. Division/modulo by zero → `ZeroDivisionError`. All arithmetic exact Decimal; percentage = `x.div(100)` (exact — fixes Ruby's Float leak).
- Comparators (`< <= > >= = == != <>`): numeric↔numeric via Decimal.cmp; string↔string lexicographic; datetime↔datetime; boolean/null only for eq/ne; mixed types → `TypeMismatchError` (**ADR-0003.3**). Equality on arrays: deep.
- Combinators `and`/`or`/`&&`/`||`: operands must be boolean, result boolean, short-circuit — **ADR-0003.2**.
- Bitwise `| & << >>`: operands must be integral Decimals (`isInteger()`), operate via BigInt, error `TypeMismatchError` otherwise.
- Case: switch-value equality against WHEN values, THEN result, optional ELSE (no match, no else → null).
- Function-call node: eager defs evaluate args then `fn(...)`; special forms call `rawFn(argNodes, ctx)`; `checkArgs` runs at parse time.
- `dependencies`: union over children; Identifier contributes its (case-normalized per options) name when not bound in ctx.

## Acceptance criteria

- Port `spec/parser_spec.rb`, `spec/ast/{arithmetic,addition,division,negation,comparator,case,node,numeric}_spec.rb`, `spec/ast/and_spec.rb`/`or_spec.rb` (operator forms) to vitest, ADR-annotating every deviation (truthiness cases → TypeMismatchError, coercion cases → TypeMismatchError, bitwise precedence cases → new expected values).
- Targeted precedence tests: `2 | 3 = 3` parses as `(2|3) = 3` (ADR-0003.4); `-2 ^ 2 = 4` (negation binds tighter, Ruby parity); `2 ^ 3 ^ 2 = 64` (left-assoc, Ruby parity); `50% * 2` exact `1`.
- `ast/node.ts` public signatures unchanged from 003's stub.
- Green per working agreement.
