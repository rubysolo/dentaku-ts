import { describe, expect, it } from "vitest";
import {
  ArgumentCountError,
  CycleError,
  DentakuError,
  MathDomainError,
  ParseError,
  TypeMismatchError,
  UnboundVariableError,
  ZeroDivisionError,
} from "../src/errors.js";

describe("error taxonomy", () => {
  it("all subclasses are instanceof DentakuError and Error with correct names", () => {
    const errors: [DentakuError, string][] = [
      [new ParseError("bad token", "unexpected-token", { position: 3 }), "ParseError"],
      [new UnboundVariableError("no binding for x", ["x"]), "UnboundVariableError"],
      [new TypeMismatchError("expected numeric"), "TypeMismatchError"],
      [new ArgumentCountError("wanted 2, got 3"), "ArgumentCountError"],
      [new ZeroDivisionError("division by zero"), "ZeroDivisionError"],
      [new MathDomainError("sqrt of negative"), "MathDomainError"],
      [new CycleError("cycle detected", ["a", "b"]), "CycleError"],
    ];
    for (const [err, name] of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DentakuError);
      expect(err.name).toBe(name);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it("carries formula and key when provided", () => {
    const err = new TypeMismatchError("boom", { formula: "1 + true", key: "total" });
    expect(err.formula).toBe("1 + true");
    expect(err.key).toBe("total");
    const bare = new TypeMismatchError("boom");
    expect(bare.formula).toBeUndefined();
    expect(bare.key).toBeUndefined();
  });

  it("ParseError carries reason and optional position", () => {
    const err = new ParseError("unexpected )", "unbalanced-parens", { position: 7 });
    expect(err.reason).toBe("unbalanced-parens");
    expect(err.position).toBe(7);
    const noPos = new ParseError("unexpected end", "eof");
    expect(noPos.position).toBeUndefined();
  });

  it("UnboundVariableError carries the unbound variable names", () => {
    const err = new UnboundVariableError("unbound: a, b", ["a", "b"]);
    expect(err.unboundVariables).toEqual(["a", "b"]);
  });

  it("CycleError carries the cycle members", () => {
    const err = new CycleError("cycle: x -> y -> x", ["x", "y"]);
    expect(err.cycle).toEqual(["x", "y"]);
  });

  it("subclasses are distinguishable by instanceof", () => {
    const err: DentakuError = new ZeroDivisionError("division by zero");
    expect(err).toBeInstanceOf(ZeroDivisionError);
    expect(err).not.toBeInstanceOf(TypeMismatchError);
  });
});
