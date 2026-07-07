# Dentaku TS

Dentaku TS is a parser and evaluator for a mathematical and logical formula
language that allows run-time binding of values to variables referenced in the
formulas. It is intended to safely evaluate untrusted expressions without
opening security holes: a formula is parsed into an AST and interpreted — it is
never handed to `eval`, it cannot reach the host environment, and it can only
compute values.

It is the TypeScript successor to the Ruby
[dentaku](https://github.com/rubysolo/dentaku) gem, by the same author: the
same formula syntax and function catalog, with deliberately tightened
semantics, typed errors, and exact decimal arithmetic. Compatibility is
measured, not assumed — see
[Migrating from Ruby dentaku](#migrating-from-ruby-dentaku).

```sh
npm install dentaku
```

Requires Node ≥ 20. ESM only.

<!--
Every fenced code block tagged `ts` in this file is extracted and executed by
tests/readme.spec.ts (see the convention documented there). `// => value`
comments are assertions, so the examples below are guaranteed accurate.
-->

## Example

This is probably simplest to illustrate in code:

```ts
import { evaluate } from "dentaku";

evaluate("10 * 2"); // => 20
```

Okay, not terribly exciting. But what if you want to have a reference to a
variable, and evaluate it at run-time? Here's how that would look:

```ts
import { evaluate } from "dentaku";

evaluate("kiwi + 5", { kiwi: 2 }); // => 7
```

You can also store variable values in a calculator's memory and then evaluate
expressions against those stored values:

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator();
calculator.store({ peaches: 15 });
calculator.evaluate("peaches - 5"); // => 10
calculator.evaluate("peaches >= 15"); // => true
```

A variable can also be bound lazily to a function, which is called (at most
once) only if the formula actually references the variable:

```ts
import { evaluate } from "dentaku";

evaluate("a + 1", { a: () => 41 }); // => 42
```

Named formulas can be stored too — they are evaluated on demand whenever the
name is referenced:

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator();
calculator.store({ population: 5000 });
calculator.storeFormula("doubled", "population * 2");
calculator.evaluate("doubled + 1"); // => 10001
```

Dentaku understands precedence order and using parentheses to group
expressions to ensure proper evaluation:

```ts
import { evaluate } from "dentaku";

evaluate("5 + 3 * 2"); // => 11
evaluate("(5 + 3) * 2"); // => 16
```

Arithmetic is exact decimal arithmetic internally (like the Ruby gem's
BigDecimal), so formulas ported from spreadsheets behave as written:

```ts
import { evaluate } from "dentaku";

evaluate("0.1 + 0.2"); // => 0.3
evaluate("0.1 + 0.2 = 0.3"); // => true
evaluate("5 / 2"); // => 2.5
```

## Errors

`evaluate` throws typed errors; `tryEvaluate` returns `undefined` instead.
(This inverts the Ruby gem's default — see the
[migration section](#migrating-from-ruby-dentaku).)

```ts
import { Calculator, UnboundVariableError } from "dentaku";

const calculator = new Calculator();
calculator.evaluate("10 * x"); // throws UnboundVariableError
calculator.tryEvaluate("10 * x"); // => undefined

try {
  calculator.evaluate("x + y");
} catch (error) {
  if (error instanceof UnboundVariableError) {
    error.unboundVariables; // => ["x", "y"]
    error.formula; // => "x + y"
  }
}
```

All errors extend `DentakuError`: `ParseError`, `UnboundVariableError`,
`TypeMismatchError`, `ArgumentCountError`, `ZeroDivisionError`,
`MathDomainError`, and `CycleError`. `tryEvaluate` swallows exactly these —
anything else indicates a bug and propagates.

## Performance

Tokenizing a string, parsing to an AST, and then evaluating that AST is far
slower than doing the same math in native code, and most of the time is spent
in tokenization and parsing. If you evaluate the same formulas repeatedly
(with different variable values), enable AST caching:

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator({ astCache: true });
calculator.evaluate("a + b * 2", { a: 1, b: 2 }); // => 5
calculator.evaluate("a + b * 2", { a: 10, b: 20 }); // => 50
```

The second call reuses the parsed AST. Caching is per calculator — there are
no global flags. If new formulas are constantly introduced to your
application, the cache grows with each one; to control eviction, pass your own
`Map` (you retain ownership of it):

```ts
import { Calculator } from "dentaku";

const cache = new Map();
const calculator = new Calculator({ astCache: cache });
calculator.evaluate("a + b * 2", { a: 1, b: 2 }); // => 5
cache.size; // => 1
cache.clear();
```

## Built-in operators and functions

Math: `+`, `-`, `*`, `/`, `%` (modulo), `^` (power), `|`, `&`, `<<`, `>>`
(bitwise), and postfix `%` (percentage):

```ts
import { evaluate } from "dentaku";

evaluate("2 ^ 10"); // => 1024
evaluate("11 % 4"); // => 3
evaluate("50% * 2"); // => 1
evaluate("0xFF >> 6"); // => 3
```

Also most functions from JS `Math`: `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`,
`ATAN`, `ATAN2`, `SINH`, `COSH`, `TANH`, `ASINH`, `ACOSH`, `ATANH`, `EXP`,
`LOG`, `LOG2`, `LOG10`, `SQRT`, `CBRT`, `HYPOT`, `POW`. These are computed in
floating point; domain errors throw instead of returning `NaN`:

```ts
import { evaluate } from "dentaku";

evaluate("SQRT(9)"); // => 3
evaluate("SQRT(-1)"); // throws MathDomainError
```

Comparison: `<`, `>`, `<=`, `>=`, `<>`, `!=`, `=`, `==` (string comparison is
lexicographic):

```ts
import { evaluate } from "dentaku";

evaluate("5 > 3"); // => true
evaluate('"apple" != "banana"'); // => true
```

Logic: `IF`, `AND`, `OR`, `XOR`, `NOT`, `SWITCH`, plus the `and`/`&&` and
`or`/`||` operators. `IF` only evaluates the branch it takes:

```ts
import { evaluate } from "dentaku";

evaluate("IF(pears < 10, 10, 20)", { pears: 5 }); // => 10
evaluate('SWITCH(2, 1, "one", 2, "two", "other")'); // => "two"
evaluate("1 < 2 and 2 < 3"); // => true
evaluate("IF(true, 1, 1 / 0)"); // => 1
```

Numeric: `MIN`, `MAX`, `SUM`, `AVG`, `MUL`, `COUNT`, `ROUND`, `ROUNDDOWN`,
`ROUNDUP`, `ABS`, `INTERCEPT`. `ROUND` follows half-up rounding rules, while
`ROUNDUP` and `ROUNDDOWN` round away from and toward zero:

```ts
import { evaluate } from "dentaku";

evaluate("SUM(1, 1, 2, 3, 5, 8)"); // => 20
evaluate("ROUND(8.2)"); // => 8
evaluate("ROUND(8.2759, 2)"); // => 8.28
evaluate("ROUNDUP(8.21, 1)"); // => 8.3
evaluate("ROUNDDOWN(8.29, 1)"); // => 8.2
evaluate("COUNT(items)", { items: [1, 2, 3, 4] }); // => 4
```

Selections: `CASE value WHEN a THEN x [WHEN b THEN y ...] [ELSE z] END`. The
switch expression does not need parentheses:

```ts
import { evaluate } from "dentaku";

evaluate('CASE n % 5 WHEN 0 THEN "fizz" ELSE "-" END', { n: 10 }); // => "fizz"
```

String: `LEFT`, `RIGHT`, `MID`, `LEN`, `FIND`, `SUBSTITUTE`, `CONCAT`,
`CONTAINS`. These work like their Excel counterparts: `MID` and `FIND` are
1-based, and `SUBSTITUTE` replaces the first occurrence:

```ts
import { evaluate } from "dentaku";

evaluate('LEFT("apple", 3)'); // => "app"
evaluate('MID("apple", 2, 3)'); // => "ppl"
evaluate('FIND("p", "apple")'); // => 2
evaluate('SUBSTITUTE("banana", "an", "AN")'); // => "bANana"
evaluate('CONCAT("app", "le")'); // => "apple"
evaluate('CONTAINS("app", "apple")'); // => true
```

Collection: `MAP`, `FILTER`, `ALL`, `ANY`, `PLUCK`, `REDUCE`. The lambda form
is an identifier followed by a body expression:

```ts
import { evaluate } from "dentaku";

evaluate("MAP(vals, x, x * 2)", { vals: [1, 2, 3] }); // => [2, 4, 6]
evaluate("FILTER(vals, x, x > 1)", { vals: [1, 2, 3] }); // => [2, 3]
evaluate("ALL(vals, x, x > 0)", { vals: [1, 2, 3] }); // => true
evaluate("ANY(vals, x, x > 2)", { vals: [1, 2, 3] }); // => true
evaluate("REDUCE(vals, acc, x, acc + x, 0)", { vals: [1, 2, 3, 4] }); // => 10
```

`PLUCK` extracts one key from an array of objects (with an optional default
as third argument):

```ts
import { evaluate } from "dentaku";

const users = [
  { name: "ada", age: 41 },
  { name: "bob", age: 17 },
];
evaluate("PLUCK(users, age)", { users }); // => [41, 17]
```

Dates: `DATE` and `DURATION`. Dates are civil (timezone-free) values
internally and cross the API boundary as JS `Date` at UTC; date + number adds
days, date − date yields days, and month/year arithmetic clamps to the end of
the month:

```ts
import { evaluate } from "dentaku";

evaluate('DATE("2026-07-04")'); // => new Date("2026-07-04T00:00:00.000Z")
evaluate("DATE(2020, 1, 31) + DURATION(1, month)"); // => new Date("2020-02-29T00:00:00.000Z")
evaluate('DATE("2020-01-01") + 7'); // => new Date("2020-01-08T00:00:00.000Z")
evaluate('DATE("2020-03-01") - DATE("2020-02-01")'); // => 29
```

Arrays, nested data, and quoted identifiers round out the formula language.
Access is zero-based; nested objects are addressable with dotted identifiers;
backticks quote identifiers containing spaces or punctuation:

```ts
import { evaluate } from "dentaku";

evaluate("SUM({1, 2, 3})"); // => 6
evaluate("scores[2]", { scores: [10, 20, 30] }); // => 30
evaluate("user[key]", { user: { name: "ada" }, key: "name" }); // => "ada"
evaluate("order.total * tax.rate", { order: { total: 100 }, tax: { rate: 0.05 } }); // => 5
evaluate("`total price` * 2", { "total price": 3 }); // => 6
```

Identifiers may contain Unicode word characters:

```ts
import { evaluate } from "dentaku";

evaluate("prix * quantité", { prix: 4, quantité: 5 }); // => 20
```

## Resolving dependencies

If your formulas rely on one another, they may need to be resolved in a
particular order. `dependencies` reports which variables an expression still
needs (taking stored values into account):

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator();
calculator.store({ monthly_income: 50 });
calculator.dependencies("monthly_income * 12"); // => []
calculator.dependencies("annual_income / 5"); // => ["annual_income"]
```

`solve` takes an object of `{ name: formula }` pairs and evaluates them in
dependency order:

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator();
calculator.store({ monthly_income: 50 });
const solved = calculator.solve({
  income_taxes: "annual_income / 5",
  annual_income: "monthly_income * 12",
});
solved; // => { annual_income: 600, income_taxes: 120 }
```

`solve` throws the first error it hits (a dependency cycle throws
`CycleError` naming the cycle members). `trySolve` never throws: every key
lands in exactly one of `values` or `errors`, and keys that don't depend on a
failing or cyclic key still solve:

```ts
import { Calculator, CycleError } from "dentaku";

const calculator = new Calculator();
const { values, errors } = calculator.trySolve({
  make_money: "have_money",
  have_money: "make_money",
  sanity: "1 + 1",
});
values; // => { sanity: 2 }
errors.make_money instanceof CycleError; // => true
errors.have_money instanceof CycleError; // => true
```

## Inline comments

If your expressions grow long or complex, you may add C-style inline comments
for future reference:

```ts
import { evaluate } from "dentaku";

evaluate("kiwi + 5 /* This is a comment */", { kiwi: 2 }); // => 7
```

Comments can be single or multi-line.

## External functions

Dentaku TS supports adding functions at runtime. A function is a descriptor
with a name, a return type, and an implementation; register it with
`addFunction` (or several with `addFunctions`). Registration is per
calculator — there is no global registry:

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator();
calculator.addFunction({
  name: "exclaim",
  returnType: "string",
  fn: (word) => `${word}!`,
});
calculator.evaluate('EXCLAIM("hello")'); // => "hello!"
```

Implementations receive and return *internal* values: numbers arrive as
[decimal.js](https://mikemcl.github.io/decimal.js/) `Decimal` instances (the
`Decimal` class is re-exported). Variadic functions declare
`maxArgs: "variadic"`:

```ts
import { Calculator, Decimal } from "dentaku";

const calculator = new Calculator();
calculator.addFunction({
  name: "biggest",
  returnType: "numeric",
  minArgs: 1,
  maxArgs: "variadic",
  fn: (...args) => Decimal.max(...(args as Decimal[])),
});
calculator.evaluate("BIGGEST(8, 6, 7, 5, 3, 0, 9)"); // => 9
```

Function names are case-insensitive (`SUM` = `sum`), and a custom function may
shadow a built-in.

## Migrating from Ruby dentaku

Dentaku TS is a successor, not a behavior-identical port. Compatibility is
measured against a 503-entry oracle corpus generated by executing Ruby
dentaku 3.5.7 over every formula in its own spec suite: **~92% of the corpus
evaluates identically**, and every intentional divergence (42 entries) is
enumerated in [`tests/oracle/allowlist.json`](tests/oracle/allowlist.json),
each citing the decision record that justifies it. Most divergences replace a
silent Ruby result with a typed error — only ~2.4% of corpus entries produce
a different *value*. The decision records live in [`docs/adr/`](docs/adr/);
any unlisted mismatch is a bug, and bug reports are welcome.

### API mapping

| Ruby dentaku | Dentaku TS | Notes |
| --- | --- | --- |
| `calc.evaluate(f)` → `nil` on error | `calc.tryEvaluate(f)` → `undefined` on error | catches only `DentakuError` subclasses |
| `calc.evaluate!(f)` raises | `calc.evaluate(f)` throws | throwing typed errors is the default |
| `calc.solve!(formulas)` | `calc.solve(formulas)` | throws the first error; cycles throw `CycleError` instead of `TSort::Cyclic` |
| `calc.solve(formulas)` → `:undefined` per failed key | `calc.trySolve(formulas)` → `{ values, errors }` | per-key typed errors; keys outside a cycle still solve instead of the whole batch failing |
| `Dentaku("x + 1", x: 1)` | `evaluate("x + 1", { x: 1 })` | stateless module-level convenience |
| `calc.store` / `calc.bind` | `calc.store` | no `bind` alias; block-transaction form removed |
| `calc.add_function(name, type, lambda)` | `calc.addFunction({ name, returnType, fn })` | |
| `Dentaku::Calculator.add_function` (global) | removed | all state is per calculator |
| `Dentaku.aliases` (i18n function aliases) | removed | 1.x backlog |
| `Dentaku.enable_ast_cache!` (global) | `new Calculator({ astCache: true })` | or pass your own `Map` |
| `Calculator.new(case_sensitive: true)` | the default | `caseInsensitiveIdentifiers: true` restores Ruby's downcasing |
| `raw_date_literals: true` (the default) | `dateLiterals: true` (default **off**) | see tightening 5 |
| `evaluate` with an array of formulas | removed | `formulas.map((f) => calc.evaluate(f))` |

### The five tightenings

Five formula-level semantics are deliberately tightened to remove known
traps. Each is recorded in [`docs/adr/`](docs/adr/) (ADR-0003/0004).

**1. Identifiers are case-sensitive.** Ruby downcased identifiers by default;
here `Kiwi` and `kiwi` are different variables. Function names remain
case-insensitive. The constructor flag restores Ruby behavior:

```ts
import { Calculator, evaluate } from "dentaku";

evaluate("Kiwi + 5", { Kiwi: -2, kiwi: 2 }); // => 3

const rubyish = new Calculator({ caseInsensitiveIdentifiers: true });
rubyish.evaluate("Kiwi + 5", { Kiwi: -2, kiwi: 2 }); // => 7
```

**2. Strict booleans in conditionals.** `IF`, `NOT`, `XOR`, and the
`and`/`or`/`&&`/`||` operators require boolean operands — there is no Ruby
truthiness where `0`, `""`, and `nil` count as true or false. Write
predicates that yield booleans; there is no restore flag:

```ts
import { evaluate } from "dentaku";

// Ruby: 1 (any non-nil, non-false value is truthy, including 0)
evaluate("IF(flag, 1, 2)", { flag: 0 }); // throws TypeMismatchError
evaluate("NOT(0)"); // throws TypeMismatchError

evaluate("IF(flag > 0, 1, 2)", { flag: 0 }); // => 2
```

This also applies to `FILTER`/`ALL`/`ANY` bodies, which must produce
booleans per item.

**3. No string→number coercion in arithmetic or comparison.** Ruby coerced
numeric strings from the variable context at evaluation time (while rejecting
the same strings as literals at parse time). Here a string is never silently
a number — convert values at the boundary instead:

```ts
import { evaluate } from "dentaku";

evaluate("qty + 2", { qty: "2" }); // throws TypeMismatchError
evaluate("qty = 2", { qty: "2" }); // throws TypeMismatchError
evaluate("qty + 2", { qty: Number("2") }); // => 4
```

(Ruby coerced and answered `4` and `true` respectively. The same applies to
numeric-string arguments of `SUM`, `ROUND`, `MIN`, `MAX`, etc.)

**4. Conventional bitwise precedence.** `|`, `&`, `<<`, `>>` bind above
comparators, as in mainstream languages. Ruby dentaku parsed them below
comparators (at the same level as `and`/`or`):

```ts
import { evaluate } from "dentaku";

// parsed as (1 | 2) > 3; Ruby parsed 1 | (2 > 3)
evaluate("1 | 2 > 3"); // => false
```

No corpus formula changes value under this rule — parenthesize if you relied
on the old grouping.

**5. Bare date literals are off by default.** Ruby's tokenizer consumed
`2020-1-1` as a date, silently eating what reads as subtraction. Here it is
arithmetic unless you opt in:

```ts
import { Calculator, evaluate } from "dentaku";

evaluate("2020-1-1"); // => 2018

const rubyish = new Calculator({ dateLiterals: true });
rubyish.evaluate("2020-1-1"); // => new Date("2020-01-01T00:00:00.000Z")
```

### Dates: explicit construction

Consistent with tightening 3, Ruby's evaluation-time string→date coercion is
gone. Dates enter a formula through the `DATE()` built-in (new in Dentaku
TS), through context values (JS `Date` accepted at the boundary), or through
opt-in date literals:

```ts
import { evaluate } from "dentaku";

evaluate("start + DURATION(1, month)", { start: "2020-01-31" }); // throws TypeMismatchError
evaluate("start + DURATION(1, month)", { start: new Date(Date.UTC(2020, 0, 31)) }); // => new Date("2020-02-29T00:00:00.000Z")
evaluate('DATE("2020-01-31") + DURATION(1, month)'); // => new Date("2020-02-29T00:00:00.000Z")
```

### Numeric precision

Like Ruby, all arithmetic is exact decimal arithmetic — but non-terminating
results (e.g. `1 / 3`) are cut off at a **fixed 20 significant digits**
(decimal.js), where Ruby's BigDecimal chose a per-operation precision (29–44
digits observed). Results agree to the shorter precision. By default results
cross the boundary as JS `number`; pass `{ raw: true }` to receive exact
`Decimal` (and civil date) values:

```ts
import { Calculator } from "dentaku";

const calculator = new Calculator();
String(calculator.evaluate("1 / 3", {}, { raw: true })); // => "0.33333333333333333333"
```

### Other differences

- **Omitted math functions**: Ruby exposes its entire `Math` module; the six
  functions with no JS `Math` equivalent are not included: `erf`, `erfc`,
  `gamma`, `lgamma`, `frexp`, `ldexp`. Register your own implementations with
  `addFunction` if you need them.
- **`CASE` switch expressions don't need parentheses**: Ruby dentaku 3.5.7
  requires `CASE (a % 5) WHEN ...`; Dentaku TS parses `CASE a % 5 WHEN ...`
  too. The parenthesized form works in both.
- **`ALL`/`ANY` no longer swallow per-item errors**: in Ruby's permissive
  mode (plain `evaluate`), an item that failed to evaluate became `nil` and
  fell through; here per-item errors propagate — under `tryEvaluate` the
  whole formula yields `undefined` rather than a partial answer:

  ```ts
  import { evaluate, tryEvaluate } from "dentaku";

  evaluate("ANY(vals, x, x > 2)", { vals: [1, "oops", 3] }); // throws TypeMismatchError
  tryEvaluate("ANY(vals, x, x > 2)", { vals: [1, "oops", 3] }); // => undefined
  ```

- **Unicode identifiers** work, matching Ruby (see example above).
- **No mutation, anywhere**: evaluation never mutates stored memory, solving
  never stores results, and caller-provided variable objects are never
  written to (Ruby's identifier cache mutated the context hash).

## Thanks

Big thanks to everyone who contributed to the Ruby
[dentaku](https://github.com/rubysolo/dentaku) gem over the years — its spec
suite is the measuring stick this library is verified against.

## License

[MIT](LICENSE). Copyright © 2012–2026 Solomon White.
