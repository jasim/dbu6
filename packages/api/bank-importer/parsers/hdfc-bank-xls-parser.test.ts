import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectPath } from "@sapporta/server";
import { describe, expect, it } from "vitest";
import {
  recognizeStatementFile,
  savedCustomStatementParserPaths,
} from "../statement-recognition.js";

const BANK_PARSER = "custom-built-parsers/hdfc-bank-xls/parser.py";
const CC_PARSER = "custom-built-parsers/hdfc-cc-xls/parser.py";
const FIXTURE =
  "custom-built-parsers/hdfc-bank-xls/fixtures/sanitized-statement.xls";

describe("HDFC Bank statement XLS parser", () => {
  it("passes its deterministic parser fixtures under Python 3.9", () => {
    const testFile = projectPath(
      "custom-built-parsers/hdfc-bank-xls/parser_test.py",
    );
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: projectPath("."),
      encoding: "utf8",
      env: { ...process.env, UV_CACHE_DIR: "/tmp/dbu6-uv-cache" },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  }, 60_000);

  it("is discovered from its fingerprint and auto-detected uniquely among the .xls parsers", async () => {
    expect(await savedCustomStatementParserPaths()).toContain(BANK_PARSER);
    // Both HDFC parsers accept `.xls`; the extension list only narrows the
    // candidates and the parsers themselves must disambiguate.
    const xlsParserPaths = await savedCustomStatementParserPaths(".xls");
    expect(xlsParserPaths).toEqual(
      expect.arrayContaining([BANK_PARSER, CC_PARSER]),
    );

    const workDir = await mkdtemp(
      path.join(tmpdir(), "dbu6-hdfc-bank-xls-detection-"),
    );
    try {
      const inputPath = path.join(workDir, "statement.xls");
      await copyFile(projectPath(FIXTURE), inputPath);

      // Cross-rejection: the credit-card parser must reject the bank export so
      // auto-detection resolves to exactly one parser.
      const recognition = await recognizeStatementFile(
        xlsParserPaths,
        inputPath,
      );
      if (recognition.outcome !== "recognized") {
        throw new Error(`not recognized: ${JSON.stringify(recognition)}`);
      }
      expect(recognition.parserPath).toBe(BANK_PARSER);
      const output = recognition.statement;
      expect(output).toMatchObject({
        account: { kind: "bank", identifier: "05050505050505" },
        institution: "HDFC BANK Ltd.",
        opening: 100000,
        closing: 95779,
      });
      expect(output.transactions).toHaveLength(8);
      expect(output.transactions[0]).toEqual({
        date: "2026-07-01",
        narration: "IB BILLPAY DR-HDFCSI-050505XXXXXX0505",
        withdrawal: 20000,
        deposit: 0,
        balance: 80000,
        source_reference: "050505050505ABCD",
      });
      // Interest rows carry an all-zero placeholder, not a reference.
      expect(output.transactions[7]).toMatchObject({
        narration: "INTEREST DEBITED TILL 31-JUL-2026",
        source_reference: null,
      });
      expect(
        output.transactions.every(
          (row: { balance: unknown }) => row.balance !== null,
        ),
      ).toBe(true);

      const wrongExtensionPath = path.join(workDir, "statement.csv");
      await copyFile(inputPath, wrongExtensionPath);
      await expect(
        recognizeStatementFile(
          await savedCustomStatementParserPaths(".csv"),
          wrongExtensionPath,
        ),
      ).resolves.toMatchObject({ outcome: "unrecognized" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
