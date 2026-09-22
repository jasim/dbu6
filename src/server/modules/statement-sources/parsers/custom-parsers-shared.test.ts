import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { packageDir } from "../../../paths.js";
import { parserProcessEnv } from "../statement-recognition.js";

// The Python side of the Abacus contract: custom-built-parsers/shared/ is
// what every deterministic parser emits through, so its own tests run
// alongside the TypeScript module's.
describe("custom-built-parsers shared modules", () => {
  it.each(["abacus_test.py", "xls_test.py"])(
    "%s passes under Python 3.9",
    (file) => {
      const testFile = packageDir(`custom-built-parsers/shared/${file}`);
      const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
        cwd: packageDir("."),
        encoding: "utf8",
        env: parserProcessEnv(),
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stderr).toContain("OK");
    },
    60_000,
  );
});
