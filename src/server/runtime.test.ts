import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { packageDir } from "./paths.js";
import { openDbu6Runtime } from "./runtime.js";

let root: string;

beforeAll(() => {
  mkdirSync(packageDir("tmp"), { recursive: true });
  root = mkdtempSync(packageDir("tmp", "runtime-test-"));
  mkdirSync(join(root, "data"));
  vi.stubEnv("SAPPORTA_DATA_DIR", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("openDbu6Runtime", () => {
  it("refuses a root other than the one DBU6_ROOT names", async () => {
    vi.stubEnv("DBU6_ROOT", packageDir("tmp"));
    await expect(openDbu6Runtime({ root })).rejects.toThrow(
      /but DBU6_ROOT names/,
    );
  });

  it("refuses a database with pending migrations, and says to migrate", async () => {
    vi.stubEnv("DBU6_ROOT", root);
    await expect(openDbu6Runtime({ root })).rejects.toThrow(
      /has migrations this dbu6 has not applied:[\s\S]*Run `dbu6 migrate`/,
    );
  });
});
