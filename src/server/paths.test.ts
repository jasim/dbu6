import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseFile } from "./paths.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("databaseFile", () => {
  it("is sqlite.db in the project's data/", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", "");
    expect(databaseFile("/sample/project")).toBe(
      "/sample/project/data/sqlite.db",
    );
  });

  // Resolved against this checkout instead, `dbu6 dev` run on a scratch
  // folder would migrate the books kept here.
  it("resolves a relative SAPPORTA_DATA_DIR against the project", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", "scratch-data");
    expect(databaseFile("/sample/project")).toBe(
      "/sample/project/scratch-data/sqlite.db",
    );
  });

  it("takes an absolute SAPPORTA_DATA_DIR as it is", () => {
    vi.stubEnv("SAPPORTA_DATA_DIR", "/sample/elsewhere");
    expect(databaseFile("/sample/project")).toBe("/sample/elsewhere/sqlite.db");
  });
});
