import { spawnSync } from "node:child_process";
import { projectPath } from "@sapporta/server";
import { describe, expect, it } from "vitest";

// The Python side of the Abacus contract: custom-built-parsers/shared/abacus.py
// is what every deterministic parser emits through, so its own tests run
// alongside the TypeScript module's.
describe("custom-built-parsers shared Abacus module", () => {
  it("passes its unit tests under Python 3.9", () => {
    const testFile = projectPath("custom-built-parsers/shared/abacus_test.py");
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: projectPath("."),
      encoding: "utf8",
      env: { ...process.env, UV_CACHE_DIR: "/tmp/dbu6-uv-cache" },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  }, 60_000);
});
