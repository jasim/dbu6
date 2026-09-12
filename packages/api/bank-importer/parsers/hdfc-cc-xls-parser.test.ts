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

const CC_PARSER = "custom-built-parsers/hdfc-cc-xls/parser.py";
const FIXTURE =
  "custom-built-parsers/hdfc-cc-xls/fixtures/sanitized-statement.xls";

describe("HDFC credit-card statement XLS parser", () => {
  it("passes its deterministic parser fixtures under Python 3.9", () => {
    const testFile = projectPath(
      "custom-built-parsers/hdfc-cc-xls/parser_test.py",
    );
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: projectPath("."),
      encoding: "utf8",
      env: { ...process.env, UV_CACHE_DIR: "/tmp/dbu6-uv-cache" },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  }, 60_000);

  it("is auto-detected uniquely among the .xls parsers and reports its card", async () => {
    const xlsParserPaths = await savedCustomStatementParserPaths(".xls");
    expect(xlsParserPaths).toContain(CC_PARSER);

    const workDir = await mkdtemp(
      path.join(tmpdir(), "dbu6-hdfc-cc-xls-detection-"),
    );
    try {
      const inputPath = path.join(workDir, "statement.xls");
      await copyFile(projectPath(FIXTURE), inputPath);

      // The bank-account parser must reject the card export so detection
      // resolves to exactly one parser.
      const recognition = await recognizeStatementFile(
        xlsParserPaths,
        inputPath,
      );
      if (recognition.outcome !== "recognized") {
        throw new Error(`not recognized: ${JSON.stringify(recognition)}`);
      }
      expect(recognition.parserPath).toBe(CC_PARSER);
      const output = recognition.statement;
      expect(output).toMatchObject({
        account: { kind: "card", identifier: "050505XXXXXX0505" },
        institution: "HDFC Bank Cards Division",
        opening: -1000.37,
        closing: -1630.37,
      });
      expect(output.transactions).toHaveLength(5);
      expect(
        output.transactions.every(
          (row: { balance: unknown }) => row.balance === null,
        ),
      ).toBe(true);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
