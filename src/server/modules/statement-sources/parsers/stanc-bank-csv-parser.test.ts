import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parserProcessEnv,
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "../statement-recognition.js";
import { packageDir } from "../../../paths.js";

describe("Standard Chartered bank CSV parser", () => {
  it("passes its deterministic parser fixtures under Python 3.9", () => {
    const testFile = packageDir(
      "custom-built-parsers/stanc-bank-csv/parser_test.py",
    );
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: packageDir("."),
      encoding: "utf8",
      env: parserProcessEnv(),
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  });

  it("is discovered from its fingerprint and auto-detected uniquely", async () => {
    const parserNames = await savedCustomStatementParserNames();
    expect(parserNames).toContain("stanc-bank-csv");
    // The extension list only narrows the candidates; the parser itself is the
    // executable fingerprint. Several `.csv` parsers legitimately coexist, so
    // the filtered list is not expected to be unique -- detection below runs
    // every candidate and requires exactly one to match.
    const csvParserNames = await savedCustomStatementParserNames(".csv");
    expect(csvParserNames).toContain("stanc-bank-csv");

    const workDir = await mkdtemp(
      path.join(tmpdir(), "dbu6-stanc-csv-detection-"),
    );
    try {
      const inputPath = path.join(workDir, "statement.csv");
      await copyFile(
        packageDir(
          "custom-built-parsers/stanc-bank-csv/fixtures/sanitized-statement.csv",
        ),
        inputPath,
      );
      const recognition = await recognizeStatementFile(
        csvParserNames,
        inputPath,
      );
      if (recognition.outcome !== "recognized") {
        throw new Error(`not recognized: ${JSON.stringify(recognition)}`);
      }
      expect(recognition.parserName).toBe("stanc-bank-csv");
      expect(recognition.statement).toMatchObject({
        account: { kind: "bank", identifier: "0505050505" },
        institution: null,
        opening: null,
        closing: 1150,
        transactions: expect.arrayContaining([
          expect.objectContaining({ narration: "Newest, deposit" }),
        ]),
      });

      const wrongExtensionPath = path.join(workDir, "statement.txt");
      await copyFile(inputPath, wrongExtensionPath);
      await expect(
        recognizeStatementFile(
          await savedCustomStatementParserNames(".txt"),
          wrongExtensionPath,
        ),
      ).resolves.toMatchObject({ outcome: "unrecognized" });

      const csvParserName = "stanc-bank-csv";
      await expect(
        recognizeStatementFile([csvParserName, csvParserName], inputPath),
      ).resolves.toMatchObject({ outcome: "ambiguous" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 30_000);
});
