import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  parserProcessEnv,
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "../statement-recognition.js";
import { packageDir } from "../../../paths.js";

const CC_PARSER = "hdfc-cc-xls";
const FIXTURE =
  "custom-built-parsers/hdfc-cc-xls/fixtures/sanitized-statement.xls";

// A project with no parsers of its own, so only the bundled ones are found.
let projectRoot: string;

beforeAll(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "dbu6-parsers-"));
  vi.stubEnv("DBU6_ROOT", projectRoot);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("HDFC credit-card statement XLS parser", () => {
  it("passes its deterministic parser fixtures under Python 3.9", () => {
    const testFile = packageDir(
      "custom-built-parsers/hdfc-cc-xls/parser_test.py",
    );
    const result = spawnSync("uv", ["run", "--python", "3.9", testFile], {
      cwd: packageDir("."),
      encoding: "utf8",
      env: parserProcessEnv(),
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("OK");
  }, 60_000);

  it("is auto-detected uniquely among the .xls parsers and reports its card", async () => {
    const xlsParserNames = await savedCustomStatementParserNames(".xls");
    expect(xlsParserNames).toContain(CC_PARSER);

    const workDir = await mkdtemp(
      path.join(tmpdir(), "dbu6-hdfc-cc-xls-detection-"),
    );
    try {
      const inputPath = path.join(workDir, "statement.xls");
      await copyFile(packageDir(FIXTURE), inputPath);

      // The bank-account parser must reject the card export so detection
      // resolves to exactly one parser.
      const recognition = await recognizeStatementFile(
        xlsParserNames,
        inputPath,
      );
      if (recognition.outcome !== "recognized") {
        throw new Error(`not recognized: ${JSON.stringify(recognition)}`);
      }
      expect(recognition.parserName).toBe(CC_PARSER);
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
