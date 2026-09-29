import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "../server/migrations.test.support.js";
import { main } from "./main.js";

let root: string;

beforeEach(() => {
  root = tempDir("main");
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, ".env"), "SAPPORTA_DATA_DIR=elsewhere\n");
  vi.stubEnv("DBU6_ROOT", root);
  vi.stubEnv("SAPPORTA_DATA_DIR", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("a project with only the former .env", () => {
  it.each([
    ["setup"],
    ["dev"],
    ["start"],
    ["migrate"],
    ["check"],
    ["upgrade"],
    ["seed"],
    ["agent", "env"],
  ])(
    "stops `dbu6 %s` before it opens a database or writes a file",
    async (...args) => {
      expect(await main(args)).toBe(1);

      expect(console.error).toHaveBeenCalledWith(
        `${join(root, ".env")} is no longer read; rename it to .env.development.`,
      );
      expect(readdirSync(root).sort()).toEqual([".env", "package.json"]);
    },
  );

  it("runs once .env.development is there too", async () => {
    writeFileSync(join(root, ".env.development"), "");

    expect(await main(["agent"])).toBe(1);
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("is no longer read"),
    );
  });
});
