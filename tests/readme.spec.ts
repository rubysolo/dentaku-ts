// Executable README (issue 015): every fenced code block tagged exactly ```ts
// in README.md is extracted and run here, so the documentation cannot drift
// from the library's behavior.
//
// The convention (mechanical — every runnable README example follows it):
//
// 1. Only blocks fenced with the `ts` language tag run; `sh`, `text`, and
//    untagged fences are ignored.
// 2. `import ... from "dentaku"` lines are removed; in their place, every
//    runtime export of ../src/index.js is provided in scope (the README shows
//    the published module name, the test runs against the source).
// 3. A line of the form `expr; // => expected` becomes
//    `expect(expr).toStrictEqual(expected)`. `expected` must be a standalone
//    JS expression (put prose on its own comment line, never after the value).
// 4. A line of the form `expr; // throws SomeError` becomes
//    `expect(() => { expr; }).toThrowError(SomeError)`.
// 5. Everything else runs verbatim. Each block is transpiled with the
//    TypeScript compiler (so examples may use type annotations) and executed
//    as the body of its own function — blocks are isolated and must be
//    self-contained.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as dentaku from "../src/index.js";

const README_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "README.md");

interface ReadmeBlock {
  /** Nearest preceding markdown heading, for the test name. */
  heading: string;
  /** 1-based README line number of the block's first code line. */
  line: number;
  code: string;
}

function extractTsBlocks(markdown: string): ReadmeBlock[] {
  const lines = markdown.split("\n");
  const blocks: ReadmeBlock[] = [];
  let heading = "(preamble)";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line);
    if (headingMatch !== null) {
      heading = (headingMatch[1] as string).trim();
    }
    if (line.trim() === "```ts") {
      const start = i + 1;
      let end = start;
      while (end < lines.length && (lines[end] as string).trim() !== "```") {
        end += 1;
      }
      blocks.push({ heading, line: start + 1, code: lines.slice(start, end).join("\n") });
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return blocks;
}

const IMPORT_LINE = /^\s*import\b[^;]*\bfrom\s+"dentaku";\s*$/;
const THROWS_ASSERTION = /^(\s*)(.+);\s*\/\/ throws\s+([A-Za-z_$][\w$]*)\s*$/;
const VALUE_ASSERTION = /^(\s*)(.+);\s*\/\/ =>\s*(.+?)\s*$/;

/** Rewrites the README assertion comments into expect() calls (rules 2-4). */
function toTestSource(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      if (IMPORT_LINE.test(line)) {
        return "";
      }
      const throwsMatch = THROWS_ASSERTION.exec(line);
      if (throwsMatch !== null) {
        const [, indent, expr, errorName] = throwsMatch;
        return `${indent}expect(() => { ${expr}; }).toThrowError(${errorName});`;
      }
      const valueMatch = VALUE_ASSERTION.exec(line);
      if (valueMatch !== null) {
        const [, indent, expr, expected] = valueMatch;
        return `${indent}expect(${expr}).toStrictEqual(${expected});`;
      }
      return line;
    })
    .join("\n");
}

function runBlock(block: ReadmeBlock): void {
  const source = toTestSource(block.code);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const libraryExports = Object.entries(dentaku);
  const run = new Function(
    ...libraryExports.map(([name]) => name),
    "expect",
    `"use strict";\n${outputText}`,
  );
  run(...libraryExports.map(([, value]) => value), expect);
}

const blocks = extractTsBlocks(readFileSync(README_PATH, "utf8"));

describe("README examples", () => {
  it("finds the fenced ts blocks (extraction guard)", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(25);
    // Every runnable block imports from "dentaku" (convention rule 2).
    for (const block of blocks) {
      expect(block.code, `block at README.md:${block.line} must import from "dentaku"`).toMatch(
        /from "dentaku";/,
      );
    }
  });

  for (const block of blocks) {
    it(`${block.heading} (README.md:${block.line})`, () => {
      runBlock(block);
    });
  }
});
