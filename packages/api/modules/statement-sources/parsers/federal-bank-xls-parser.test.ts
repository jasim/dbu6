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

const FEDERAL_PARSER = "custom-built-parsers/federal-bank-xls/parser.py";
const HDFC_BANK_PARSER = "custom-built-parsers/hdfc-bank-xls/parser.py";
const HDFC_CC_PARSER = "custom-built-parsers/hdfc-cc-xls/parser.py";
const FIXTURE =
  "custom-built-parsers/federal-bank-xls/fixtures/sanitized-statement.xls";

describe("Federal Bank statement XLS parser", () => {
  it("passes its deterministic parser fixtures under Python 3.9", () => {
    const testFile = projectPath(
      "custom-built-parsers/federal-bank-xls/parser_test.py",
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
    expect(await savedCustomStatementParserPaths()).toContain(FEDERAL_PARSER);
    // Three parsers accept `.xls`; the extension list only narrows the
    // candidates and the parsers themselves must disambiguate.
    const xlsParserPaths = await savedCustomStatementParserPaths(".xls");
    expect(xlsParserPaths).toEqual(
      expect.arrayContaining([
        FEDERAL_PARSER,
        HDFC_BANK_PARSER,
        HDFC_CC_PARSER,
      ]),
    );

    const workDir = await mkdtemp(
      path.join(tmpdir(), "dbu6-federal-bank-xls-detection-"),
    );
    try {
      const inputPath = path.join(workDir, "statement.xls");
      await copyFile(projectPath(FIXTURE), inputPath);

      // Cross-rejection: both HDFC parsers must reject the Federal export so
      // auto-detection resolves to exactly one parser.
      const recognition = await recognizeStatementFile(
        xlsParserPaths,
        inputPath,
      );
      if (recognition.outcome !== "recognized") {
        throw new Error(`not recognized: ${JSON.stringify(recognition)}`);
      }
      expect(recognition.parserPath).toBe(FEDERAL_PARSER);
      const output = recognition.statement;
      expect(output).toMatchObject({
        account: { kind: "bank", identifier: "050505000012" },
        institution: null,
        opening: null,
        closing: null,
      });
      expect(output.transactions).toHaveLength(9);
      expect(output.transactions[0]).toEqual({
        date: "2026-07-01",
        narration: "UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505",
        withdrawal: 500,
        deposit: 0,
        balance: 99500,
        source_reference: "050505000001",
      });
      expect(output.transactions[3]).toMatchObject({
        narration: "FT IMPS/IFI/050505000004/NOPII CUSTOMER/sample remark",
        deposit: 40000,
        source_reference: "050505000004",
      });
      // Layouts without a known reference field carry no source_reference.
      expect(output.transactions[7]).toMatchObject({
        narration: "SMS CHARGES sample",
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
