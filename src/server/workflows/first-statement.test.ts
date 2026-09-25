import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { CategorizationConfigError } from "../modules/categorization/index.js";
import {
  insertJournalPlan,
  loadOpeningEntries,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { parseAccount } from "../modules/values/index.js";
import { packageDir } from "../paths.js";

// The parsers are stubbed, here and in the import that runs after: these
// tests are about what a recognition becomes. Every parser exists.
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
  parserDirectory: async (name: string) => `/sample/parsers/${name}`,
}));

// The engine would detect this machine's coding agents. The stand-in
// categorizer places every row by rule, so no LLM is asked.
vi.mock("../modules/coding-agent/categorization-llm.js", () => ({
  categorizationLlm: async () => ({
    agent: null,
    name: "no coding agent",
    caller: { ready: false, reason: "No coding agent is installed." },
  }),
}));

import { recordOpeningBalance } from "./opening-balances.js";
import {
  importFirstStatement,
  loadFirstStatements,
  recognizeSample,
} from "./first-statement.js";

const loadCategorizer: LoadCategorizer = async (settings) => ({
  classify: { ok: true, value: () => parseAccount("Groceries") },
  customMappings: { ok: true, value: "" },
  llm: settings.llm,
});

// The import's tail refuses: the config loads, and breaks on the first row
// it classifies, past every check made before writing.
const failingCategorizer: LoadCategorizer = async (settings) => ({
  classify: {
    ok: true,
    value: () => {
      throw new CategorizationConfigError("NOPII mappings file is broken.");
    },
  },
  customMappings: { ok: true, value: "" },
  llm: settings.llm,
});

/*
 * Sample Savings (2) and Sample Card (4), each alone in its institution.
 * Sample Bank lists no parser and gives Sample Savings no number. Sample
 * Cards reads its statements with sample-cc-csv, and Sample Card's number
 * is set. Nothing is imported yet; Groceries takes every row.
 */
function books(): Ledger {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      (2, 'workspace', 'user', 'Sample Savings', 1, 'Asset', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      (3, 'workspace', 'user', 'Liabilities', NULL, 'Liability', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      (4, 'workspace', 'user', 'Sample Card', 3, 'Liability', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
      (5, 'workspace', 'user', 'Groceries', NULL, 'Expense', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
  `);
  const preset = sqlite.prepare(
    `INSERT INTO import_presets (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
     VALUES ('workspace', 'user', ?, ?, ?, '2026-09-01T00:00:00Z')`,
  );
  const account = (id: number, name: string, identifiers: string[]) =>
    JSON.stringify([
      {
        account_id: id,
        name,
        is_credit_card: id === 4,
        account_identifiers: identifiers,
        custom_mappings_filenames: [],
      },
    ]);
  preset.run("Sample Bank", "[]", account(2, "Sample Savings", []));
  preset.run(
    "Sample Cards",
    '["sample-cc-csv"]',
    account(4, "Sample Card", ["050505XXXXXX0505"]),
  );
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

// A savings statement: 5,000 in on 3 August, 1,000 out on 10 August.
function savingsStatement({
  opening = null,
  balances = [null, null],
  closing = null,
}: {
  opening?: number | null;
  balances?: [number | null, number | null];
  closing?: number | null;
} = {}) {
  return {
    outcome: "recognized",
    parserName: "sample-bank-xls",
    statement: {
      transactions: [
        {
          date: "2026-08-03",
          narration: "NOPII SALARY",
          withdrawal: 0,
          deposit: 5000,
          balance: balances[0],
        },
        {
          date: "2026-08-10",
          narration: "NOPII GROCERIES",
          withdrawal: 1000,
          deposit: 0,
          balance: balances[1],
        },
      ],
      opening,
      closing,
      account: { kind: "bank", identifier: "050505000012" },
      institution: "SAMPLE BANK LTD",
    },
  };
}

// A card statement printing `identifier`: owed 2,000, then 1,000 spent.
function cardStatement(identifier: string) {
  return {
    outcome: "recognized",
    parserName: "sample-cc-csv",
    statement: {
      transactions: [
        {
          date: "2026-08-05",
          narration: "NOPII STORE",
          withdrawal: 1000,
          deposit: 0,
          balance: null,
        },
      ],
      opening: -2000,
      closing: -3000,
      account: { kind: "card", identifier },
      institution: "SAMPLE CARDS",
    },
  };
}

// The statement moved to another month of 2026 ("07" for July).
function shifted<T extends { statement: { transactions: { date: string }[] } }>(
  read: T,
  month: string,
): T {
  return {
    ...read,
    statement: {
      ...read.statement,
      transactions: read.statement.transactions.map((row) => ({
        ...row,
        date: row.date.replace("2026-08-", `2026-${month}-`),
      })),
    },
  };
}

const SAVINGS_FILE = { name: "NOPII.xls", path: "/sample/NOPII.xls" };

function importSavings(
  ledger: Ledger,
  more: { openingAmount?: number; useStatementNumber?: boolean } = {},
) {
  return importFirstStatement(ledger, loadCategorizer, {
    accountId: 2,
    statement: SAVINGS_FILE,
    openingAmount: more.openingAmount ?? null,
    useStatementNumber: more.useStatementNumber ?? false,
  });
}

function presetAccount(ledger: Ledger, accountId: number) {
  for (const institution of loadImportPresets(ledger.db, ledger.auth)) {
    const account = institution.accounts.find(
      (one) => one.account_id === accountId,
    );
    if (account) return { institution, account };
  }
  throw new Error(`No preset lists ${accountId}`);
}

function drafts(ledger: Ledger, accountId: number) {
  return ledger.sqlite
    .prepare(
      `SELECT date, withdrawal, deposit FROM draft_transactions
       WHERE base_account_id = ? ORDER BY date`,
    )
    .all(accountId);
}

beforeEach(() => {
  recognizeStatementFile.mockReset();
  savedCustomStatementParserNames.mockClear();
});

describe("recognizeSample", () => {
  it("shows what a read statement holds and the changes importing makes", async () => {
    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ opening: 10000 }),
    );

    const outcome = await recognizeSample(books(), 2, "/sample/NOPII.xls");

    expect(savedCustomStatementParserNames).toHaveBeenCalledWith(".xls");
    expect(outcome).toEqual({
      ok: true,
      finding: {
        outcome: "recognized",
        parser: "sample-bank-xls",
        printed_identifier: "050505000012",
        printed_institution: "SAMPLE BANK LTD",
        period: { first_date: "2026-08-03", last_date: "2026-08-10" },
        transactions: 2,
        opening: { date: "2026-08-02", amount: 10000 },
        existing_opening: null,
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
            account_id: 2,
            account_identifiers: ["050505000012"],
          },
        ],
      },
    });
  });

  it("says which parsers it tried, or which matched, when it can't tell", async () => {
    recognizeStatementFile.mockResolvedValueOnce({
      outcome: "unrecognized",
      candidateParserNames: ["sample-bank-xls"],
    });
    expect(await recognizeSample(books(), 2, "/sample/NOPII.xls")).toEqual({
      ok: true,
      finding: { outcome: "unrecognized", tried: ["sample-bank-xls"] },
    });

    recognizeStatementFile.mockResolvedValueOnce({
      outcome: "ambiguous",
      matchingParserNames: ["a", "b"],
    });
    expect(await recognizeSample(books(), 2, "/sample/NOPII.xls")).toEqual({
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

describe("importFirstStatement", () => {
  it("ties the account to its format, records the statement's opening and imports it", async () => {
    const ledger = books();
    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ balances: [15000, 14000] }),
    );

    const done = await importSavings(ledger);

    expect(done.ok && done.outcome.kind).toBe("imported");
    const { institution, account } = presetAccount(ledger, 2);
    expect(institution.parsers).toEqual(["sample-bank-xls"]);
    expect(account.account_identifiers).toEqual(["050505000012"]);
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).get(2)).toMatchObject(
      { date: "2026-08-02", amount: 10000 },
    );
    expect(drafts(ledger, 2)).toEqual([
      { date: "2026-08-03", withdrawal: 0, deposit: 5000 },
      { date: "2026-08-10", withdrawal: 1000, deposit: 0 },
    ]);

    const step = await loadFirstStatements(ledger, new Map());
    expect(step.accounts[0]).toMatchObject({
      account_id: 2,
      status: "imported",
      activity: { entries: 0, drafts: 2, uncategorized: 0 },
    });
  });

  it("asks for the opening balance of a statement that prints none, and writes nothing", async () => {
    const ledger = books();
    recognizeStatementFile.mockResolvedValue(savingsStatement());

    expect(await importSavings(ledger)).toEqual({
      ok: false,
      refusal: {
        code: "opening_balance_needed",
        error: expect.stringContaining("2026-08-02"),
      },
    });
    expect(presetAccount(ledger, 2).institution.parsers).toEqual([]);
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).size).toBe(0);

    const done = await importSavings(ledger, { openingAmount: 10000 });

    expect(done.ok && done.outcome.kind).toBe("imported");
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).get(2)).toMatchObject(
      { date: "2026-08-02", amount: 10000 },
    );
    expect(drafts(ledger, 2)).toHaveLength(2);
  });

  it("records no second opening entry for an account that has one", async () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-07-31",
      amount: 10000,
    });
    recognizeStatementFile.mockResolvedValue(savingsStatement());

    expect(await recognizeSample(ledger, 2, SAVINGS_FILE.path)).toMatchObject({
      ok: true,
      finding: { existing_opening: { date: "2026-07-31", amount: 10000 } },
    });
    const done = await importSavings(ledger, { openingAmount: 999 });

    expect(done.ok && done.outcome.kind).toBe("imported");
    const openings = loadOpeningEntries(ledger.sqlite, ledger.auth);
    expect(openings.get(2)).toMatchObject({
      date: "2026-07-31",
      amount: 10000,
    });
    expect(
      ledger.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM journal_entries WHERE account_id = 2",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(drafts(ledger, 2)).toHaveLength(2);
  });

  it("imports over a number that differs only once the statement's is accepted", async () => {
    const ledger = books();
    recognizeStatementFile.mockResolvedValue(cardStatement("050505XXXXXX0606"));
    const importCard = (useStatementNumber: boolean) =>
      importFirstStatement(ledger, loadCategorizer, {
        accountId: 4,
        statement: { name: "NOPII.csv", path: "/sample/NOPII.csv" },
        openingAmount: null,
        useStatementNumber,
      });

    expect(await importCard(false)).toEqual({
      ok: false,
      refusal: {
        code: "numbers_differ",
        error: expect.stringContaining("050505XXXXXX0606"),
      },
    });
    expect(presetAccount(ledger, 4).account.account_identifiers).toEqual([
      "050505XXXXXX0505",
    ]);

    const done = await importCard(true);

    expect(done.ok && done.outcome.kind).toBe("imported");
    expect(presetAccount(ledger, 4).account.account_identifiers).toEqual([
      "050505XXXXXX0606",
    ]);
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).get(4)).toMatchObject(
      { date: "2026-08-04", amount: -2000 },
    );
  });

  it("writes nothing when the statement fails its own checks", async () => {
    const ledger = books();
    // The rows reach 14,000, but the statement says it closed at 20,000.
    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ opening: 10000, closing: 20000 }),
    );

    const done = await importSavings(ledger);

    expect(done.ok && done.outcome).toMatchObject({
      kind: "failed",
      failedBaseAccount: "Sample Savings",
      error: { name: "BalanceMismatchError" },
    });
    expect(presetAccount(ledger, 2).institution.parsers).toEqual([]);
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).size).toBe(0);
    expect(drafts(ledger, 2)).toEqual([]);
  });

  it("keeps the format and the opening when the import's tail fails", async () => {
    const ledger = books();
    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ opening: 10000, closing: 14000 }),
    );

    const done = await importFirstStatement(ledger, failingCategorizer, {
      accountId: 2,
      statement: SAVINGS_FILE,
      openingAmount: null,
      useStatementNumber: false,
    });

    expect(done.ok && done.outcome.kind).toBe("failed");
    expect(presetAccount(ledger, 2).institution.parsers).toEqual([
      "sample-bank-xls",
    ]);
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).get(2)).toMatchObject(
      { date: "2026-08-02", amount: 10000 },
    );
    expect(drafts(ledger, 2)).toEqual([]);

    // The step still offers the staged statement, with the opening it
    // recorded, and "Try again" records no second one.
    const step = await loadFirstStatements(
      ledger,
      new Map([[2, { path: SAVINGS_FILE.path, projectPath: "tmp/NOPII.xls" }]]),
    );
    expect(step.accounts[0]).toMatchObject({
      status: "read",
      activity: { entries: 0, drafts: 0 },
      finding: { existing_opening: { date: "2026-08-02", amount: 10000 } },
    });
    const again = await importSavings(ledger);
    expect(again.ok && again.outcome.kind).toBe("imported");
    expect(drafts(ledger, 2)).toHaveLength(2);
  });

  it("refuses an earlier statement after a failed import, and takes a later one", async () => {
    const ledger = books();
    // August's import fails after its opening (2 August) is recorded.
    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ opening: 10000, closing: 14000 }),
    );
    await importFirstStatement(ledger, failingCategorizer, {
      accountId: 2,
      statement: SAVINGS_FILE,
      openingAmount: null,
      useStatementNumber: false,
    });

    // July's rows would all fall behind that opening.
    recognizeStatementFile.mockResolvedValue(
      shifted(savingsStatement({ opening: 9000, closing: 13000 }), "07"),
    );
    expect(await importSavings(ledger)).toEqual({
      ok: false,
      refusal: {
        code: "opening_after_statement_start",
        error: expect.stringContaining("2026-07-03"),
      },
    });
    expect(drafts(ledger, 2)).toEqual([]);

    // September's starts after it: a gap, which the balance checks show.
    recognizeStatementFile.mockResolvedValue(
      shifted(savingsStatement({ opening: 15000, closing: 19000 }), "09"),
    );
    const done = await importSavings(ledger);
    expect(done.ok && done.outcome.kind).toBe("imported");
    expect(drafts(ledger, 2)).toHaveLength(2);
  });

  it("refuses a statement starting on its opening's day, or from another balance the day after", async () => {
    const onFirstRow = books();
    recordOpeningBalance(onFirstRow, {
      accountId: 2,
      date: "2026-08-03",
      amount: 10000,
    });
    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ opening: 10000 }),
    );
    expect(await importSavings(onFirstRow)).toMatchObject({
      ok: false,
      refusal: { code: "opening_after_statement_start" },
    });

    const disagrees = books();
    recordOpeningBalance(disagrees, {
      accountId: 2,
      date: "2026-08-02",
      amount: 9000,
    });
    expect(await importSavings(disagrees)).toMatchObject({
      ok: false,
      refusal: {
        code: "opening_disagrees",
        error: expect.stringContaining("9,000.00"),
      },
    });
    expect(drafts(disagrees, 2)).toEqual([]);
  });

  it("refuses a statement no parser reads, and an account with transactions", async () => {
    const ledger = books();
    recognizeStatementFile.mockResolvedValueOnce({
      outcome: "unrecognized",
      candidateParserNames: [],
    });
    expect(await importSavings(ledger)).toMatchObject({
      ok: false,
      refusal: { code: "statement_unreadable" },
    });

    recognizeStatementFile.mockResolvedValue(
      savingsStatement({ opening: 10000 }),
    );
    await importSavings(ledger);
    expect(await importSavings(ledger)).toMatchObject({
      ok: false,
      refusal: { code: "already_imported" },
    });
  });
});

describe("loadFirstStatements", () => {
  it("gives each bank or card one state, and who categorizes", async () => {
    recognizeStatementFile.mockResolvedValue({
      outcome: "unrecognized",
      candidateParserNames: ["sample-bank-xls"],
    });

    const step = await loadFirstStatements(
      books(),
      new Map([
        [
          2,
          {
            path: "/sample/NOPII.pdf",
            projectPath: "tmp/statement-uploads/setup-sample-2/NOPII.pdf",
          },
        ],
      ]),
    );

    expect(step.categorizer).toEqual({
      ready: false,
      name: "no coding agent",
      reason: "No coding agent is installed.",
    });
    expect(step.accounts).toEqual([
      {
        account_id: 2,
        name: "Sample Savings",
        kind: "bank",
        institution: "Sample Bank",
        account_identifiers: [],
        activity: { entries: 0, drafts: 0, uncategorized: 0 },
        status: "unreadable",
        finding: {
          outcome: "unrecognized",
          tried: ["sample-bank-xls"],
          saved_path: "tmp/statement-uploads/setup-sample-2/NOPII.pdf",
        },
      },
      {
        account_id: 4,
        name: "Sample Card",
        kind: "card",
        institution: "Sample Cards",
        account_identifiers: ["050505XXXXXX0505"],
        activity: { entries: 0, drafts: 0, uncategorized: 0 },
        status: "needs_statement",
      },
    ]);
  });
});

describe("a card's first statement", () => {
  const CARD_FILE = { name: "NOPII.csv", path: "/sample/NOPII.csv" };
  const importCard = (ledger: Ledger, openingAmount: number | null = null) =>
    importFirstStatement(ledger, loadCategorizer, {
      accountId: 4,
      statement: CARD_FILE,
      openingAmount,
      useStatementNumber: false,
    });
  // Owed 3,000 after the 1,000 spent, as each row prints it, and no
  // opening or closing.
  const withRowBalances = () => {
    const read = cardStatement("050505XXXXXX0505");
    return {
      ...read,
      statement: {
        ...read.statement,
        transactions: read.statement.transactions.map((row) => ({
          ...row,
          balance: -3000,
        })),
        opening: null,
        closing: null,
      },
    };
  };

  it("opens at the first printed balance less the rows up to it", async () => {
    const ledger = books();
    recognizeStatementFile.mockResolvedValue(withRowBalances());

    const done = await importCard(ledger);

    expect(done.ok && done.outcome.kind).toBe("imported");
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).get(4)).toMatchObject(
      { date: "2026-08-04", amount: -2000 },
    );
    expect(drafts(ledger, 4)).toEqual([
      { date: "2026-08-05", withdrawal: 1000, deposit: 0 },
    ]);
  });

  it("writes nothing when it prints no closing, which a card's import needs", async () => {
    const ledger = books();
    const read = withRowBalances();
    recognizeStatementFile.mockResolvedValue({
      ...read,
      statement: {
        ...read.statement,
        transactions: read.statement.transactions.map((row) => ({
          ...row,
          balance: null,
        })),
      },
    });

    const done = await importCard(ledger, -2000);

    expect(done.ok && done.outcome).toMatchObject({
      kind: "failed",
      error: { name: "ClosingBalanceUnavailable" },
    });
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).size).toBe(0);
    expect(drafts(ledger, 4)).toEqual([]);
  });

  it("isn't imported by a payment another account's import posted to it", async () => {
    const ledger = books();
    // The savings statement's card payment, posted with the card as its
    // category: the import keys the category's line.
    const line = { assertion: null, sourceReference: null };
    insertJournalPlan(
      ledger.db,
      [
        {
          date: "2026-07-20",
          description: "NOPII CARD PAYMENT",
          entries: [
            {
              ...line,
              account: 4,
              amount: 1000,
              comment: "NOPII CARD PAYMENT",
              sourceTransactionKey: "sample-key-050505",
            },
            {
              ...line,
              account: 2,
              amount: -1000,
              comment: null,
              sourceTransactionKey: null,
            },
          ],
        },
      ],
      ledger.auth,
    );

    const step = await loadFirstStatements(ledger, new Map());
    expect(step.accounts.map((row) => [row.status, row.activity])).toEqual([
      ["imported", { entries: 1, drafts: 0, uncategorized: 0 }],
      ["needs_statement", { entries: 0, drafts: 0, uncategorized: 0 }],
    ]);

    // Its statement starts after the payment, where no opening can go.
    recognizeStatementFile.mockResolvedValue(cardStatement("050505XXXXXX0505"));
    expect(await importCard(ledger)).toEqual({
      ok: false,
      refusal: {
        code: "activity_before_statement",
        error: expect.stringContaining("2026-07-20"),
      },
    });
    expect(loadOpeningEntries(ledger.sqlite, ledger.auth).has(4)).toBe(false);
  });
});
