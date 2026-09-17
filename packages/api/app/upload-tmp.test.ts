import { access, readFile, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectPath } from "@sapporta/server";
import { uploadedFile, withStagedUploads } from "./upload-tmp.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const SUBDIR = "upload-tmp-test";

describe("withStagedUploads", () => {
  it("stages a batch inside the project and deletes it again", async () => {
    let workDir = "";
    let staged: string[] = [];
    let projectPaths: string[] = [];

    await withStagedUploads(
      [
        new File(["first"], "statement.csv"),
        new File(["second"], "statement.csv"),
      ],
      SUBDIR,
      async (batch) => {
        workDir = dirname(batch.paths[0]);
        staged = batch.paths;
        projectPaths = batch.projectPaths;

        expect(batch.paths).toHaveLength(2);
        expect(new Set(batch.paths).size).toBe(2);
        expect(batch.paths.map((p) => dirname(p))).toEqual([workDir, workDir]);
        expect(batch.paths.map((p) => basename(p).endsWith(".csv"))).toEqual([
          true,
          true,
        ]);
        await expect(
          Promise.all(batch.paths.map((p) => readFile(p, "utf8"))),
        ).resolves.toEqual(["first", "second"]);
      },
    );

    // The batch lives under the project's own tmp/, and its paths are
    // reported relative to the project root for the prompts to print.
    expect(workDir.startsWith(projectPath("tmp", SUBDIR))).toBe(true);
    expect(projectPaths.every((p) => !isAbsolute(p))).toBe(true);
    expect(projectPaths.map((p) => projectPath(p))).toEqual(staged);
    await expect(exists(workDir)).resolves.toBe(false);
  });

  it("keeps the batch when the handler asks for it", async () => {
    let kept = "";
    const path = await withStagedUploads(
      [new File(["first"], "statement.csv")],
      SUBDIR,
      async (batch) => {
        batch.keep();
        kept = batch.paths[0];
        return batch.projectPaths[0];
      },
    );

    try {
      await expect(exists(kept)).resolves.toBe(true);
      expect(path).toBe(
        join("tmp", SUBDIR, basename(dirname(kept)), "0-statement.csv"),
      );
    } finally {
      await rm(dirname(kept), { recursive: true, force: true });
    }
  });
});

describe("uploadedFile", () => {
  it("returns only non-empty File fields", () => {
    const file = new File(["activity"], "My Activities.html");

    expect(uploadedFile({ gpay: file }, "gpay")).toBe(file);
    expect(
      uploadedFile({ gpay: new File([], "empty.html") }, "gpay"),
    ).toBeNull();
    expect(uploadedFile({ gpay: "not-a-file" }, "gpay")).toBeNull();
  });
});
