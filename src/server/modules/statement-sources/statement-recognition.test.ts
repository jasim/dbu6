import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packageParsersDir, parserRoots } from "../../paths.js";
import {
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "./statement-recognition.js";

// A user's project: a scratch root that is not the package directory, with
// its own custom-built-parsers/. The bundled parsers stay where the package
// is, so both roots are in play.
let root: string;

// A parser as a user's agent writes one: it reaches the bundled `shared`
// package by name, with nothing on sys.path of its own. It reads
// `date,narration,amount` lines under a fixed header.
function sampleParser(institution: string): string {
  return `#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
from pathlib import Path

from shared import abacus

HEADER = "sample-ledger-050505,date,narration,amount"


def build(source: Path):
    lines = source.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != HEADER:
        raise ValueError("not a sample ledger")
    rows = []
    for line in lines[1:]:
        date, narration, amount = line.split(",")
        rows.append(
            abacus.row(date=date, narration=narration, withdrawal=amount, deposit=0, balance=None)
        )
    statement = abacus.statement(
        rows=rows, opening=None, closing=None, account=None, institution="${institution}"
    )
    return statement, f"{len(rows)} rows"


if __name__ == "__main__":
    abacus.run_cli(build, usage="<sample-ledger.sample>", error_types=(ValueError,))
`;
}

async function writeProjectParser(
  name: string,
  extension: string,
  institution: string,
): Promise<void> {
  const directory = path.join(root, "custom-built-parsers", name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "parser.py"), sampleParser(institution));
  await writeFile(
    path.join(directory, "fingerprint.md"),
    `# Sample ledger\n\n**Input extensions:** \`${extension}\`\n`,
  );
}

async function sampleLedger(): Promise<string> {
  const inputPath = path.join(root, "statement.sample");
  await writeFile(
    inputPath,
    "sample-ledger-050505,date,narration,amount\n2026-01-05,NOPII sample payee,1000\n",
  );
  return inputPath;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "dbu6-parsers-")));
  vi.stubEnv("DBU6_ROOT", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("saved parsers from two roots", () => {
  it("looks in the project's parsers first, then the bundled ones", () => {
    expect(parserRoots()).toEqual([
      path.join(root, "custom-built-parsers"),
      packageParsersDir(),
    ]);
  });

  it("lists the project's parsers beside the bundled ones, by directory name", async () => {
    await writeProjectParser("sample-ledger", ".sample", "NOPII Sample Bank");

    expect(await savedCustomStatementParserNames(".sample")).toEqual([
      "sample-ledger",
    ]);
    const all = await savedCustomStatementParserNames();
    expect(all).toContain("sample-ledger");
    expect(all).toContain("hdfc-bank-xls");
  });

  it("recognizes a statement with a project parser that imports the bundled shared package", async () => {
    await writeProjectParser("sample-ledger", ".sample", "NOPII Sample Bank");

    const recognition = await recognizeStatementFile(
      await savedCustomStatementParserNames(".sample"),
      await sampleLedger(),
    );

    if (recognition.outcome !== "recognized") {
      throw new Error(`not recognized: ${JSON.stringify(recognition)}`);
    }
    expect(recognition.parserName).toBe("sample-ledger");
    expect(recognition.statement.institution).toBe("NOPII Sample Bank");
    expect(recognition.statement.transactions).toHaveLength(1);
  }, 60_000);

  it("runs the project's parser in place of a bundled one of the same name", async () => {
    // The bundled hdfc-bank-xls reads .xls; the project's copy declares its
    // own extension, and it is the project's fingerprint that is read.
    await writeProjectParser("hdfc-bank-xls", ".sample", "NOPII Shadow Bank");

    expect(await savedCustomStatementParserNames(".sample")).toEqual([
      "hdfc-bank-xls",
    ]);
    expect(await savedCustomStatementParserNames(".xls")).not.toContain(
      "hdfc-bank-xls",
    );
    const recognition = await recognizeStatementFile(
      ["hdfc-bank-xls"],
      await sampleLedger(),
    );
    expect(recognition).toMatchObject({
      outcome: "recognized",
      statement: { institution: "NOPII Shadow Bank" },
    });
  }, 60_000);
});
