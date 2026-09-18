import { spawnSync } from "node:child_process";
import { projectPath } from "@sapporta/server";
import { describe, expect, it } from "vitest";

describe("Standard Chartered credit-card parser", () => {
  it("passes its sanitized parser fixtures under uv", () => {
    const testFile = projectPath(
      "custom-built-parsers/stanc-cc-pdf/parser_test.py",
    );
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: projectPath("."),
      encoding: "utf8",
      env: { ...process.env, UV_CACHE_DIR: "/tmp/dbu6-uv-cache" },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  });
});
