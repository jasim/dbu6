import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadedFile, withStagedUploads } from "./upload-tmp.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// A scratch project root, so nothing is staged in the real one.
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dbu6-upload-tmp-"));
  vi.stubEnv("DBU6_ROOT", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

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
    expect(dirname(workDir)).toBe(join(root, "tmp", "statement-uploads"));
    expect(projectPaths.every((p) => !isAbsolute(p))).toBe(true);
    expect(projectPaths.map((p) => join(root, p))).toEqual(staged);
    await expect(exists(workDir)).resolves.toBe(false);
  });

  it("keeps the batch when the handler asks for it", async () => {
    let kept = "";
    const path = await withStagedUploads(
      [new File(["first"], "statement.csv")],
      async (batch) => {
        batch.keep();
        kept = batch.paths[0];
        return batch.projectPaths[0];
      },
    );

    await expect(exists(kept)).resolves.toBe(true);
    expect(path).toBe(
      join(
        "tmp",
        "statement-uploads",
        basename(dirname(kept)),
        "0-statement.csv",
      ),
    );
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
