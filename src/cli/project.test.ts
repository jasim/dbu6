import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "../server/migrations.test.support.js";
import { devFolder, envFile, formerEnvFileProblem } from "./project.js";

let root: string;

beforeEach(() => {
  root = tempDir("project");
  vi.stubEnv("SAPPORTA_DATA_DIR", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("devFolder", () => {
  it("takes a folder holding only hidden files for an empty one", () => {
    writeFileSync(join(root, ".DS_Store"), "");
    mkdirSync(join(root, ".git"));

    expect(devFolder(root)).toBe("empty");
  });

  it("refuses a folder with files but no database, and creates nothing", () => {
    writeFileSync(join(root, "package.json"), "{}\n");

    expect(() => devFolder(root)).toThrow(/creates nothing here/);
    expect(readdirSync(root)).toEqual(["package.json"]);
  });

  it("takes a folder with a database for a project", () => {
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "sqlite.db"), "");

    expect(devFolder(root)).toBe("project");
  });
});

describe("envFile", () => {
  it("is Sapporta's .env.development, where its CLI looks for the port", () => {
    expect(envFile(root)).toBe(join(root, ".env.development"));
  });
});

describe("formerEnvFileProblem", () => {
  it("names a .env left without .env.development", () => {
    writeFileSync(join(root, ".env"), "");

    expect(formerEnvFileProblem(root)).toMatch(
      /rename it to \.env\.development/,
    );
  });

  it("has nothing to say once .env.development exists, or with neither file", () => {
    expect(formerEnvFileProblem(root)).toBeNull();
    writeFileSync(join(root, ".env"), "");
    writeFileSync(join(root, ".env.development"), "");
    expect(formerEnvFileProblem(root)).toBeNull();
  });
});
