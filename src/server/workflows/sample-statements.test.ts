import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";

// The parsers are stubbed: these tests are about what a recognition becomes.
const { recognizeStatementFile, savedCustomStatementParserNames } = vi.hoisted(
  () => ({
    recognizeStatementFile: vi.fn(),
    savedCustomStatementParserNames: vi.fn(async () => ["sample-bank-xls"]),
  }),
);
vi.mock("../modules/statement-sources/index.js", async (importActual) => ({
  ...(await importActual<object>()),
  recognizeStatementFile,
  savedCustomStatementParserNames,
}));

import { loadStatementFormats, recognizeSample } from "./sample-statements.js";

/*
 * Sample Bank lists no parser and holds Sample Savings (8), with no number.
 * Sample Cards reads its statements with sample-cc-csv and holds Sample Card
 * (9), whose number is set.
 */
function books(): Ledger {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  const account = (id: number, name: string, identifiers: string[]) =>
    JSON.stringify([
      {
        account_id: id,
        name,
        is_credit_card: id === 9,
        account_identifiers: identifiers,
        custom_mappings_filenames: [],
      },
    ]);
  sqlite
    .prepare(
      `INSERT INTO import_presets (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
       VALUES ('workspace', 'user', ?, ?, ?, '2026-09-01T00:00:00Z')`,
    )
    .run("Sample Bank", "[]", account(8, "Sample Savings", []));
  sqlite
    .prepare(
      `INSERT INTO import_presets (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
       VALUES ('workspace', 'user', ?, ?, ?, '2026-09-01T00:00:00Z')`,
    )
    .run(
      "Sample Cards",
      '["sample-cc-csv"]',
      account(9, "Sample Card", ["050505XXXXXX0505"]),
    );
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

beforeEach(() => {
  recognizeStatementFile.mockReset();
  savedCustomStatementParserNames.mockClear();
});

describe("recognizeSample", () => {
  it("proposes the changes a recognized sample implies, with its period", async () => {
    recognizeStatementFile.mockResolvedValue({
      outcome: "recognized",
      parserName: "sample-bank-xls",
      statement: {
        transactions: [
          { date: "2026-08-01", narration: "NOPII", balance: null },
          { date: "2026-08-30", narration: "NOPII", balance: null },
        ],
        opening: null,
        closing: null,
        account: { kind: "bank", identifier: "050505000012" },
        institution: "SAMPLE BANK LTD",
      },
    });

    const outcome = await recognizeSample(books(), 8, "/sample/NOPII.xls");

    expect(savedCustomStatementParserNames).toHaveBeenCalledWith(".xls");
    expect(outcome).toEqual({
      ok: true,
      finding: {
        outcome: "recognized",
        parser: "sample-bank-xls",
        printed_identifier: "050505000012",
        printed_institution: "SAMPLE BANK LTD",
        period: { first_date: "2026-08-01", last_date: "2026-08-30" },
        parser_institution: null,
        institution: "Sample Bank",
        moves: false,
        identifier_state: "set",
        changes: [
          {
            kind: "add_parser",
            institution: "Sample Bank",
            parser: "sample-bank-xls",
          },
          {
            kind: "update_account",
            account_id: 8,
            account_identifiers: ["050505000012"],
          },
        ],
        keep_mine: null,
      },
    });
  });

  it("says which parsers it tried, or which matched, when it can't tell", async () => {
    recognizeStatementFile.mockResolvedValueOnce({
      outcome: "unrecognized",
      candidateParserNames: ["sample-bank-xls"],
    });
    expect(await recognizeSample(books(), 8, "/sample/NOPII.xls")).toEqual({
      ok: true,
      finding: { outcome: "unrecognized", tried: ["sample-bank-xls"] },
    });

    recognizeStatementFile.mockResolvedValueOnce({
      outcome: "ambiguous",
      matchingParserNames: ["a", "b"],
    });
    expect(await recognizeSample(books(), 8, "/sample/NOPII.xls")).toEqual({
      ok: true,
      finding: { outcome: "ambiguous", parsers: ["a", "b"] },
    });
  });

  it("runs no parser for an account no preset lists", async () => {
    expect(await recognizeSample(books(), 42, "/sample/NOPII.xls")).toEqual({
      ok: false,
      code: "unknown_account",
    });
    expect(recognizeStatementFile).not.toHaveBeenCalled();
  });
});

describe("loadStatementFormats", () => {
  it("is ready with a parser and a number, and waits for a parser with a staged sample", () => {
    const rows = loadStatementFormats(
      books(),
      new Map([[8, "tmp/statement-uploads/setup-sample-8/NOPII.pdf"]]),
    );

    expect(
      rows.map((row) => [row.name, row.status, row.staged_sample]),
    ).toEqual([
      [
        "Sample Savings",
        "waiting_for_parser",
        "tmp/statement-uploads/setup-sample-8/NOPII.pdf",
      ],
      ["Sample Card", "ready", null],
    ]);
    expect(
      loadStatementFormats(books(), new Map()).map((row) => row.status),
    ).toEqual(["needs_sample", "ready"]);
  });
});
