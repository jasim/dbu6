import { access, readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { uploadedFile, withTempUploads } from "./upload-tmp.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("withTempUploads", () => {
  it("uses unique paths for duplicate basenames while preserving extensions", async () => {
    let capturedWorkDir = "";
    let capturedPaths: string[] = [];

    await withTempUploads(
      [
        new File(["first"], "statement.csv"),
        new File(["second"], "statement.csv"),
      ],
      "upload-tmp-test",
      async (workDir, paths) => {
        capturedWorkDir = workDir;
        capturedPaths = paths;

        expect(paths).toHaveLength(2);
        expect(new Set(paths).size).toBe(2);
        expect(paths.map((p) => dirname(p))).toEqual([workDir, workDir]);
        expect(paths.map((p) => basename(p).endsWith(".csv"))).toEqual([
          true,
          true,
        ]);
        await expect(
          Promise.all(paths.map((p) => readFile(p, "utf8"))),
        ).resolves.toEqual(["first", "second"]);
      },
    );

    expect(capturedPaths).toHaveLength(2);
    await expect(exists(capturedWorkDir)).resolves.toBe(false);
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
