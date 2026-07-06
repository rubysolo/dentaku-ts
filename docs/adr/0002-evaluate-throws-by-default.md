# evaluate() throws by default, inverting the Ruby posture

Ruby Dentaku's `evaluate` returns nil on any error and `evaluate!` raises. In dentaku-ts, `evaluate()` throws typed errors and `tryEvaluate()` provides the swallowing behavior. This deliberately inverts the original's default: silent undefined-on-error is a footgun TypeScript users won't anticipate, and bang-method naming has no TS equivalent. Which formulas produce which error classes is part of the language; how errors are delivered to the host is not.
