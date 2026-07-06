# Dentaku TS

TypeScript successor to the Dentaku formula language: a parser and evaluator for mathematical and logical expressions with run-time variable binding, safe for evaluating untrusted input.

## Language

**Spiritual successor**:
Dentaku TS's relationship to Ruby Dentaku — same surface syntax and function catalog (~95%+ of the Ruby spec-suite formula corpus evaluates unchanged), but with deliberately tightened semantics (see ADR-0003) and a redesigned host API. Not a behavior-identical port.
_Avoid_: port, 1:1 port, functional equivalence

**Formula**:
An expression string in the Dentaku language, supplied at run time and potentially untrusted.
_Avoid_: script, code

**Tightening**:
A deliberate, ADR-recorded semantic break from Ruby Dentaku that removes a known trap (e.g. strict booleans in conditionals). Distinct from an accidental incompatibility, which is a bug.
_Avoid_: breaking change (too broad), deviation

**Memory**:
The variable bindings stored durably on a Calculator via `store()`. Distinct from per-call variables, which are passed to a single `evaluate()`/`solve()` call and never persist.
_Avoid_: context (ambiguous), data

**Oracle corpus**:
The machine-generated golden file of (formula, variables) → result/error entries produced by executing the Ruby gem over its own spec-suite formulas. Dentaku TS must reproduce it exactly, minus the divergence allowlist.
_Avoid_: golden tests (too generic)

**Divergence allowlist**:
The enumerated set of oracle-corpus entries where Dentaku TS intentionally differs from Ruby, each justified by a tightening in ADR-0003/0004. Any unlisted mismatch is a bug.
_Avoid_: known failures, skip list
