import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { packageDir } from "../../../paths.js";
import { parserProcessEnv } from "../statement-recognition.js";

describe("Standard Chartered credit-card parser", () => {
  it("passes its sanitized parser fixtures under uv", () => {
    const testFile = packageDir(
      "custom-built-parsers/stanc-cc-pdf/parser_test.py",
    );
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: packageDir("."),
      encoding: "utf8",
      env: parserProcessEnv(),
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  });
});
