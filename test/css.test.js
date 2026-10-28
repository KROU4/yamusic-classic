import { describe, it, expect } from "vitest";
import fs from "node:fs";

// A lost closing brace doesn't break the build: CSS nesting silently pulls every later rule into the
// unclosed block (e.g. into a narrow-window media query). Merges of appended CSS caused exactly that once.
describe("app.css", () => {
  it("has balanced braces", () => {
    const css = fs.readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let line = 1;
    for (const c of css) {
      if (c === "\n") line++;
      if (c === "{") depth++;
      if (c === "}") depth--;
      if (depth < 0) throw new Error(`extra } near line ${line}`);
    }
    expect(depth).toBe(0);
  });
});
