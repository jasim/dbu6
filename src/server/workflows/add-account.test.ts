import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddAccountFields } from "../../shared/index.js";
import {
  CategorizationConfigError,
  type LoadCategorizer,
} from "../modules/categorization/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import {
  insertJournalPlan,
  loadOpeningEntries,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { parseAccount } from "../modules/values/index.js";
import { packageDir } from "../paths.js";

// The parsers are stubbed, here and in the import that runs after: these
// tests are about what the recognitions become. Every parser exists.
const { recognizeStatementFile } = vi.hoisted(() => ({
  recognizeStatementFile: vi.fn(),
}));
vi.mock("../modules/statement-sources/index.js", async (importActual) => ({
  ...(await importActual<object>()),
  recognizeStatementFile,
  savedCustomStatementParserNames: async () => [
    "other-bank-pdf",
    "other-card-csv",
    "sample-bank-xls",
    "sample-cc-csv",
  ],
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

import {
  addAccount,
  groupDrop,
  readStatements,
  statementOpening,
  tidyBankName,
  type DroppedStatement,
} from "./add-account.js";
import { recordOpeningBalance } from "./opening-balances.js";

const loadCategorizer: LoadCategorizer = async (settings) => ({
  classify: { ok: true, value: () => parseAccount("Groceries") },
  customMappings: { ok: true, value: "" },
  llm: settings.llm,
});

/*
 * Sample Savings (2) under Assets, Sample Card (4) under Liabilities, and
 * Sample Wallet (6), an asset no bank or card uses. Sample Bank reads its
 * statements with sample-bank-xls and gives Sample Savings no number;
 * Sample Cards reads with sample-cc-csv, and Sample Card's number is set.
 * No preset lists other-bank-pdf or other-card-csv. Nothing is imported
 * yet; Groceries takes every row.
 */
function books(): Ledger {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  const now = "2026-09-01T00:00:00Z";
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '${now}', '${now}'),
      (2, 'workspace', 'user', 'Sample Savings', 1, 'Asset', '${now}', '${now}'),
      (3, 'workspace', 'user', 'Liabilities', NULL, 'Liability', '${now}', '${now}'),
      (4, 'workspace', 'user', 'Sample Card', 3, 'Liability', '${now}', '${now}'),
      (5, 'workspace', 'user', 'Groceries', NULL, 'Expense', '${now}', '${now}'),
      (6, 'workspace', 'user', 'Sample Wallet', 1, 'Asset', '${now}', '${now}');
  `);
  const preset = sqlite.prepare(
    `INSERT INTO import_presets (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
     VALUES ('workspace', 'user', ?, ?, ?, '${now}')`,
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
  preset.run(
    "Sample Bank",
    '["sample-bank-xls"]',
    account(2, "Sample Savings", []),
  );
  preset.run(
    "Sample Cards",
    '["sample-cc-csv"]',
    account(4, "Sample Card", ["050505XXXXXX0505"]),
  );
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

/*
 * The dropped files: each one's path, and what the parsers make of it. A
 * file several parsers read is ambiguous unless the recognition runs one of
 * them alone; one none reads is unrecognized.
 */
type Fixture = { parsers: string[]; statement: object } | null;
const fixtures = new Map<string, Fixture>();

function dropped(name: string, fixture: Fixture): DroppedStatement {
  const path = `/sample/${name}`;
  fixtures.set(path, fixture);
  return { name, path, projectPath: `tmp/statement-uploads/sample/${name}` };
}

// A project of its own: a new bank or card looks for the default
// instructions in its user-config/, and the parsers read in its tmp/.
let root: string;

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-add-account-"));
  vi.stubEnv("DBU6_ROOT", root);
  fixtures.clear();
  recognizeStatementFile.mockReset();
  recognizeStatementFile.mockImplementation(
    async (parsers: string[], path: string) => {
      const fixture = fixtures.get(path);
      const readers = (fixture?.parsers ?? []).filter((one) =>
        parsers.includes(one),
      );
      if (readers.length === 0) {
        return { outcome: "unrecognized", candidateParserNames: parsers };
      }
      if (readers.length > 1) {
        return { outcome: "ambiguous", matchingParserNames: readers };
      }
      return {
        outcome: "recognized",
        parserName: readers[0],
        statement: fixture!.statement,
      };
    },
  );
});

// A statement's rows, `[date, amount]`: in when positive, out when negative.
type Row = [string, number];

function statement(
  rows: Row[],
  more: {
    opening?: number | null;
    closing?: number | null;
    balances?: (number | null)[];
    account?: { kind: "bank" | "card"; identifier: string } | null;
    institution?: string | null;
  } = {},
) {
  return {
    transactions: rows.map(([date, amount], index) => ({
      date,
      narration: `NOPII ROW ${index + 1}`,
      withdrawal: amount < 0 ? -amount : 0,
      deposit: amount > 0 ? amount : 0,
      balance: more.balances?.[index] ?? null,
    })),
    opening: more.opening ?? null,
    closing: more.closing ?? null,
    account: more.account ?? null,
    institution: more.institution ?? null,
  };
}

// 5,000 in on the 3rd of 2026's `month` ("08"), 1,000 out on the 10th.
function monthRows(month: string): Row[] {
  return [
    [`2026-${month}-03`, 5000],
    [`2026-${month}-10`, -1000],
  ];
}

// Sample Savings' statement for a month, from `opening`.
function savings(month: string, opening: number | null = 10000) {
  return {
    parsers: ["sample-bank-xls"],
    statement: statement(monthRows(month), {
      opening,
      closing: opening === null ? null : opening + 4000,
      account: { kind: "bank", identifier: "050505000012" },
      institution: "SAMPLE BANK LTD",
    }),
  };
}

// Sample Card's statement for a month: `owed` before 1,000 spent on the 5th.
function card(month: string, owed = 2000) {
  return {
    parsers: ["sample-cc-csv"],
    statement: statement([[`2026-${month}-05`, -1000]], {
      opening: -owed,
      closing: -(owed + 1000),
      account: { kind: "card", identifier: "050505XXXXXX0505" },
      institution: "SAMPLE CARDS",
    }),
  };
}

// A bank no preset lists, for a month, from `opening`.
function otherBank(
  month: string,
  more: { opening?: number | null; closing?: number | null } = {},
) {
  const opening = more.opening === undefined ? 10000 : more.opening;
  return {
    parsers: ["other-bank-pdf"],
    statement: statement(monthRows(month), {
      opening,
      closing:
        more.closing !== undefined
          ? more.closing
          : opening === null
            ? null
            : opening + 4000,
      account: { kind: "bank", identifier: "050505000099" },
      institution: "OTHER SAMPLE BANK LIMITED.",
    }),
  };
}

// A card no preset lists, owing 2,000 before 1,000 spent in August.
function otherCard() {
  return {
    parsers: ["other-card-csv"],
    statement: statement([["2026-08-05", -1000]], {
      opening: -2000,
      closing: -3000,
      account: { kind: "card", identifier: "050505XXXXXX0909" },
      institution: "OTHER SAMPLE CARDS",
    }),
  };
}

function read(ledger: Ledger, files: DroppedStatement[]) {
  return readStatements(ledger, files);
}

function add(
  ledger: Ledger,
  files: DroppedStatement[],
  fields: AddAccountFields = {},
  categorizer: LoadCategorizer = loadCategorizer,
) {
  return addAccount(ledger, categorizer, files, fields);
}

function presetOf(ledger: Ledger, accountId: number) {
  for (const institution of loadImportPresets(ledger.db, ledger.auth)) {
    const account = institution.accounts.find(
      (one) => one.account_id === accountId,
    );
    if (account) return { institution, account };
  }
  return null;
}

function ledgerAccount(ledger: Ledger, name: string) {
  return ledger.sqlite
    .prepare(
      "SELECT id, name, parent_id, account_type FROM accounts WHERE name = ?",
    )
    .get(name) as
    | { id: number; name: string; parent_id: number; account_type: string }
    | undefined;
}

function drafts(ledger: Ledger, accountId: number) {
  return ledger.sqlite
    .prepare(
      `SELECT date, withdrawal, deposit FROM draft_transactions
       WHERE base_account_id = ? ORDER BY date`,
    )
    .all(accountId);
}

function opening(ledger: Ledger, accountId: number) {
  const entry = loadOpeningEntries(ledger.sqlite, ledger.auth).get(accountId);
  return entry && { date: entry.date, amount: entry.amount };
}

describe("readStatements", () => {
  it("places each file with its account, earliest first", async () => {
    const reading = await read(books(), [
      dropped("NOPII-card.csv", card("08")),
      dropped("NOPII-savings.xls", savings("07")),
      dropped("NOPII-other.pdf", otherBank("09")),
    ]);

    expect(reading.files).toEqual([
      {
        status: "read",
        file_name: "NOPII-card.csv",
        account_key: "account:4",
        parser: "sample-cc-csv",
        period: { first_date: "2026-08-05", last_date: "2026-08-05" },
        transactions: 1,
        saved_path: null,
      },
      {
        status: "read",
        file_name: "NOPII-savings.xls",
        account_key: "account:2",
        parser: "sample-bank-xls",
        period: { first_date: "2026-07-03", last_date: "2026-07-10" },
        transactions: 2,
        saved_path: null,
      },
      {
        status: "read",
        file_name: "NOPII-other.pdf",
        account_key: "new:bank:050505000099",
        parser: "other-bank-pdf",
        period: { first_date: "2026-09-03", last_date: "2026-09-10" },
        transactions: 2,
        saved_path: null,
      },
    ]);
    expect(reading.accounts.map((one) => one.key)).toEqual([
      "account:2",
      "account:4",
      "new:bank:050505000099",
    ]);
    expect(reading.accounts[0]).toEqual({
      key: "account:2",
      status: "empty",
      account: { id: 2, name: "Sample Savings" },
      institution: "Sample Bank",
      institution_listed: true,
      kind: "bank",
      identifier: "050505000012",
      parsers: ["sample-bank-xls"],
      file_names: ["NOPII-savings.xls"],
      period: { first_date: "2026-07-03", last_date: "2026-07-10" },
      transactions: 2,
      opening: { date: "2026-07-02", amount: 10000 },
      needs_opening: false,
      opening_refusal: null,
      refusal: null,
    });
    expect(reading.accounts[1]).toMatchObject({
      status: "empty",
      kind: "card",
      opening: { date: "2026-08-04", amount: -2000 },
    });
    // The bank no preset lists goes by the name its statements print.
    expect(reading.accounts[2]).toEqual({
      key: "new:bank:050505000099",
      status: "new",
      account: null,
      institution: "Other Sample Bank",
      institution_listed: false,
      kind: "bank",
      identifier: "050505000099",
      parsers: ["other-bank-pdf"],
      file_names: ["NOPII-other.pdf"],
      period: { first_date: "2026-09-03", last_date: "2026-09-10" },
      transactions: 2,
      opening: { date: "2026-09-02", amount: 10000 },
      needs_opening: false,
      opening_refusal: null,
      refusal: null,
    });
    expect(reading.categorizer).toEqual({
      ready: false,
      name: "no coding agent",
      reason: "No coding agent is installed.",
    });
  });

  it("assembles one account's statements in date order, whatever order they came in", async () => {
    const reading = await read(books(), [
      dropped("NOPII-feb.pdf", otherBank("02", { opening: 14000 })),
      dropped("NOPII-jan.pdf", otherBank("01")),
    ]);

    expect(reading.accounts).toHaveLength(1);
    expect(reading.accounts[0]).toMatchObject({
      file_names: ["NOPII-jan.pdf", "NOPII-feb.pdf"],
      period: { first_date: "2026-01-03", last_date: "2026-02-10" },
      transactions: 4,
      opening: { date: "2026-01-02", amount: 10000 },
      refusal: null,
    });
  });

  it("refuses a gap between two statements with what's missing", async () => {
    // January closes at 14,000; March opens at 16,000.
    const reading = await read(books(), [
      dropped("NOPII-jan.pdf", otherBank("01")),
      dropped("NOPII-mar.pdf", otherBank("03", { opening: 16000 })),
    ]);

    const [account] = reading.accounts;
    expect(account).toMatchObject({
      period: { first_date: "2026-01-03", last_date: "2026-03-10" },
      opening: { date: "2026-01-02", amount: 10000 },
    });
    expect(account.refusal).toMatchObject({
      name: "StatementBoundaryMismatchError",
      earlierClosing: 14000,
      laterOpening: 16000,
      difference: 2000,
    });
  });

  it("gives a late start as its dates alone", async () => {
    const [account] = (
      await read(books(), [dropped("NOPII-mar.pdf", otherBank("03"))])
    ).accounts;

    expect(account.period).toEqual({
      first_date: "2026-03-03",
      last_date: "2026-03-10",
    });
    expect(account.refusal).toBeNull();
  });

  it("asks for no opening's refusal when the statements print no balance", async () => {
    const [account] = (
      await read(books(), [
        dropped("NOPII.pdf", otherBank("08", { opening: null })),
      ])
    ).accounts;

    expect(account.opening).toEqual({ date: "2026-08-02", amount: null });
    expect(account.needs_opening).toBe(true);
    expect(account.refusal).toBeNull();

    // Two such files can't be placed against each other: /import refuses.
    const [two] = (
      await read(books(), [
        dropped("NOPII-jul.pdf", otherBank("07", { opening: null })),
        dropped("NOPII-aug.pdf", otherBank("08", { opening: null })),
      ])
    ).accounts;
    expect(two.refusal).toMatchObject({ name: "StatementPartUnjoinableError" });
  });

  it("says neither kind nor bank for statements that print neither", async () => {
    const bare = otherBank("08");
    const reading = await read(books(), [
      dropped("NOPII.pdf", {
        ...bare,
        statement: { ...bare.statement, account: null, institution: null },
      }),
    ]);

    expect(reading.accounts[0]).toMatchObject({
      key: "new:parser:other-bank-pdf",
      status: "new",
      institution: "",
      institution_listed: false,
      kind: null,
      identifier: null,
    });
  });

  it("spells a bank as the presets do", async () => {
    const ledger = books();
    ledger.sqlite.exec(`
      INSERT INTO import_presets (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
      VALUES ('workspace', 'user', 'OTHER Sample Bank', '[]', '[]', '2026-09-01T00:00:00Z');
    `);

    const [account] = (
      await read(ledger, [dropped("NOPII.pdf", otherBank("08"))])
    ).accounts;

    expect(account).toMatchObject({
      status: "new",
      institution: "OTHER Sample Bank",
      institution_listed: false,
    });
  });

  it("takes a bank set up with its number and no parser", async () => {
    const ledger = books();
    // As an agent sets one up through /api/setup/statement-accounts.
    ledger.sqlite.exec(`
      INSERT INTO import_presets (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
      VALUES ('workspace', 'user', 'Other Sample Bank', '[]',
        '[{"account_id":6,"name":"Sample Wallet","is_credit_card":false,"account_identifiers":["050505000099"],"custom_mappings_filenames":[]}]',
        '2026-09-01T00:00:00Z');
    `);
    const files = [dropped("NOPII.pdf", otherBank("08"))];

    expect((await read(ledger, files)).accounts[0]).toMatchObject({
      key: "account:6",
      status: "empty",
      account: { id: 6, name: "Sample Wallet" },
      institution: "Other Sample Bank",
      institution_listed: true,
      needs_opening: false,
    });

    // Adding it lists the parser.
    expect(await add(ledger, files)).toEqual({
      ok: true,
      added: { account_id: 6, account_name: "Sample Wallet", drafts: 2 },
    });
    expect(presetOf(ledger, 6)?.institution.parsers).toEqual([
      "other-bank-pdf",
    ]);
    expect((await read(ledger, files)).accounts[0].status).toBe("in_books");

    // A statement that prints no number is no set-up account's.
    const bare = otherBank("09");
    const [unnumbered] = (
      await read(ledger, [
        dropped("NOPII-sep.pdf", {
          parsers: ["other-card-csv"],
          statement: { ...bare.statement, account: null },
        }),
      ])
    ).accounts;
    expect(unnumbered).toMatchObject({ status: "new", kind: null });
  });

  it("reports an opening the books would refuse", async () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-08-02",
      amount: 9000,
    });

    const [account] = (
      await read(ledger, [dropped("NOPII.xls", savings("08"))])
    ).accounts;

    expect(account.opening_refusal).toEqual({
      code: "opening_disagrees",
      error: expect.stringContaining("9,000.00"),
    });
    expect(account.needs_opening).toBe(false);
  });

  it("asks for no opening of an account that has one", async () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-08-02",
      amount: 10000,
    });

    const [account] = (
      await read(ledger, [dropped("NOPII.xls", savings("08", null))])
    ).accounts;

    expect(account).toMatchObject({
      status: "empty",
      opening: { date: "2026-08-02", amount: null },
      needs_opening: false,
      opening_refusal: null,
      refusal: null,
    });
  });

  it("refuses a card's statement with no closing", async () => {
    const statementOf = otherCard();
    const reading = await read(books(), [
      dropped("NOPII.csv", {
        ...statementOf,
        statement: { ...statementOf.statement, closing: null },
      }),
    ]);

    expect(reading.accounts[0]).toMatchObject({
      kind: "card",
      refusal: { name: "ClosingBalanceUnavailable" },
    });
  });

  it("tells an account set up with no transactions from one already in the books", async () => {
    const ledger = books();
    const files = [dropped("NOPII.xls", savings("08"))];
    expect((await read(ledger, files)).accounts[0].status).toBe("empty");

    await add(ledger, files);

    expect((await read(ledger, files)).accounts[0]).toMatchObject({
      status: "in_books",
      account: { id: 2, name: "Sample Savings" },
    });
  });

  it("points at the staged copy of a file no parser reads, or several do", async () => {
    const reading = await read(books(), [
      dropped("NOPII-unknown.pdf", null),
      dropped("NOPII-both.xls", {
        parsers: ["other-bank-pdf", "sample-bank-xls"],
        statement: savings("08").statement,
      }),
    ]);

    expect(reading.files).toEqual([
      {
        status: "unrecognized",
        file_name: "NOPII-unknown.pdf",
        saved_path: "tmp/statement-uploads/sample/NOPII-unknown.pdf",
        candidate_parser_paths: [
          "other-bank-pdf",
          "other-card-csv",
          "sample-bank-xls",
          "sample-cc-csv",
        ],
      },
      {
        status: "ambiguous",
        file_name: "NOPII-both.xls",
        saved_path: "tmp/statement-uploads/sample/NOPII-both.xls",
        matching_parser_paths: ["other-bank-pdf", "sample-bank-xls"],
      },
    ]);
    expect(reading.accounts).toEqual([]);
  });
});

describe("addAccount", () => {
  it("adds a new bank with its preset, opening and drafts", async () => {
    const ledger = books();

    const done = await add(ledger, [dropped("NOPII.pdf", otherBank("08"))], {
      institution: "Other Sample Bank",
      name: "Sample Current",
    });

    const created = ledgerAccount(ledger, "Sample Current")!;
    expect(done).toEqual({
      ok: true,
      added: {
        account_id: created.id,
        account_name: "Sample Current",
        drafts: 2,
      },
    });
    // Under the parent Sample Bank's accounts share.
    expect(created).toMatchObject({ parent_id: 1, account_type: "Asset" });
    const preset = presetOf(ledger, created.id)!;
    expect(preset.institution).toMatchObject({
      name: "Other Sample Bank",
      parsers: ["other-bank-pdf"],
    });
    expect(preset.account).toMatchObject({
      name: "Sample Current",
      is_credit_card: false,
      account_identifiers: ["050505000099"],
    });
    expect(opening(ledger, created.id)).toEqual({
      date: "2026-08-02",
      amount: 10000,
    });
    expect(drafts(ledger, created.id)).toEqual([
      { date: "2026-08-03", withdrawal: 0, deposit: 5000 },
      { date: "2026-08-10", withdrawal: 1000, deposit: 0 },
    ]);
  });

  it("adds a new card to a bank of the name given, with what it owed", async () => {
    const ledger = books();

    const done = await add(ledger, [dropped("NOPII.csv", otherCard())], {
      // What a statement prints wins over what the form says.
      kind: "bank",
      institution: "Sample Cards",
      name: "Sample Other Card",
    });

    expect(done.ok).toBe(true);
    const created = ledgerAccount(ledger, "Sample Other Card")!;
    expect(created).toMatchObject({ parent_id: 3, account_type: "Liability" });
    const preset = presetOf(ledger, created.id)!;
    expect(preset.institution).toMatchObject({
      name: "Sample Cards",
      parsers: ["sample-cc-csv", "other-card-csv"],
    });
    expect(preset.account).toMatchObject({
      is_credit_card: true,
      account_identifiers: ["050505XXXXXX0909"],
    });
    expect(opening(ledger, created.id)).toEqual({
      date: "2026-08-04",
      amount: -2000,
    });
  });

  it("ties a bank to an account from the chart", async () => {
    const ledger = books();

    const done = await add(ledger, [dropped("NOPII.pdf", otherBank("08"))], {
      institution: "Other Sample Bank",
      account_id: 6,
    });

    expect(done).toEqual({
      ok: true,
      added: { account_id: 6, account_name: "Sample Wallet", drafts: 2 },
    });
    expect(presetOf(ledger, 6)?.institution.name).toBe("Other Sample Bank");
    expect(opening(ledger, 6)).toEqual({ date: "2026-08-02", amount: 10000 });
  });

  it("finishes a bank set up with no transactions", async () => {
    const ledger = books();

    const done = await add(ledger, [dropped("NOPII.xls", savings("08"))], {
      // Ignored: the account is fixed, and its bank lists the parser.
      name: "NOPII Ignored",
      institution: "NOPII Ignored",
    });

    expect(done).toEqual({
      ok: true,
      added: { account_id: 2, account_name: "Sample Savings", drafts: 2 },
    });
    expect(presetOf(ledger, 2)).toMatchObject({
      institution: { name: "Sample Bank" },
      account: { account_identifiers: ["050505000012"] },
    });
    expect(opening(ledger, 2)).toEqual({ date: "2026-08-02", amount: 10000 });
    expect(ledgerAccount(ledger, "NOPII Ignored")).toBeUndefined();
  });

  it("asks for the opening of statements that print no balance, and writes nothing", async () => {
    const ledger = books();
    const files = [dropped("NOPII.pdf", otherBank("08", { opening: null }))];

    expect(
      await add(ledger, files, {
        institution: "Other Sample Bank",
        name: "Sample Current",
      }),
    ).toEqual({
      ok: false,
      code: "opening_balance_needed",
      error: expect.stringContaining("2026-08-02"),
    });
    expect(ledgerAccount(ledger, "Sample Current")).toBeUndefined();

    const done = await add(ledger, files, {
      institution: "Other Sample Bank",
      name: "Sample Current",
      opening_amount: 10000,
    });

    expect(done.ok).toBe(true);
    const created = ledgerAccount(ledger, "Sample Current")!;
    expect(opening(ledger, created.id)).toEqual({
      date: "2026-08-02",
      amount: 10000,
    });
    expect(drafts(ledger, created.id)).toHaveLength(2);
  });

  it("keeps an opening that agrees, and refuses one that doesn't", async () => {
    const agrees = books();
    recordOpeningBalance(agrees, {
      accountId: 2,
      date: "2026-08-02",
      amount: 10000,
    });
    expect((await add(agrees, [dropped("NOPII.xls", savings("08"))])).ok).toBe(
      true,
    );
    expect(
      agrees.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM journal_entries WHERE account_id = 2",
        )
        .get(),
    ).toEqual({ n: 1 });

    const disagrees = books();
    recordOpeningBalance(disagrees, {
      accountId: 2,
      date: "2026-08-02",
      amount: 9000,
    });
    expect(
      await add(disagrees, [dropped("NOPII.xls", savings("08"))]),
    ).toMatchObject({
      ok: false,
      code: "opening_disagrees",
      error: expect.stringContaining("9,000.00"),
    });
    expect(drafts(disagrees, 2)).toEqual([]);

    const later = books();
    recordOpeningBalance(later, {
      accountId: 2,
      date: "2026-08-05",
      amount: 10000,
    });
    expect(
      await add(later, [dropped("NOPII.xls", savings("08"))]),
    ).toMatchObject({ ok: false, code: "opening_after_statement_start" });
  });

  it("refuses an opening behind a payment another account's import posted", async () => {
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

    expect(await add(ledger, [dropped("NOPII.csv", card("08"))])).toMatchObject(
      {
        ok: false,
        code: "activity_before_statement",
        error: expect.stringContaining("2026-07-20"),
      },
    );
    expect(opening(ledger, 4)).toBeUndefined();
  });

  it("refuses files from several accounts, and an account in the books", async () => {
    const ledger = books();

    expect(
      await add(ledger, [
        dropped("NOPII.xls", savings("08")),
        dropped("NOPII.csv", card("08")),
      ]),
    ).toEqual({
      ok: false,
      code: "several_accounts",
      error:
        "These are from Sample Savings and Sample Card. Add one account's statements at a time.",
    });
    expect(opening(ledger, 2)).toBeUndefined();

    await add(ledger, [dropped("NOPII.xls", savings("08"))]);
    expect(
      await add(ledger, [dropped("NOPII-sep.xls", savings("09", 14000))]),
    ).toMatchObject({ ok: false, code: "already_in_books" });
  });

  it("writes nothing when the import's checks refuse the statements", async () => {
    const ledger = books();

    // The rows reach 14,000, but the statement says it closed at 20,000.
    const done = await add(
      ledger,
      [dropped("NOPII.pdf", otherBank("08", { closing: 20000 }))],
      { institution: "Other Sample Bank", name: "Sample Current" },
    );

    expect(done).toMatchObject({
      ok: false,
      code: "import_refused",
      importError: { name: "BalanceMismatchError" },
    });
    expect(ledgerAccount(ledger, "Sample Current")).toBeUndefined();
    expect(
      loadImportPresets(ledger.db, ledger.auth).map((one) => one.name),
    ).toEqual(["Sample Bank", "Sample Cards"]);
  });

  it("keeps the account, its format and its opening when the import's tail fails, and adding again finishes it", async () => {
    const ledger = books();
    const files = () => [dropped("NOPII.pdf", otherBank("08"))];
    // The config loads, and breaks on the first row it classifies, past
    // every check made before writing.
    const failing: LoadCategorizer = async (settings) => ({
      classify: {
        ok: true,
        value: () => {
          throw new CategorizationConfigError("NOPII mappings file is broken.");
        },
      },
      customMappings: { ok: true, value: "" },
      llm: settings.llm,
    });

    expect(
      await add(
        ledger,
        files(),
        { institution: "Other Sample Bank", name: "Sample Current" },
        failing,
      ),
    ).toMatchObject({
      ok: false,
      code: "import_refused",
      importError: { name: "CategorizationConfigError" },
    });
    const created = ledgerAccount(ledger, "Sample Current")!;
    expect(presetOf(ledger, created.id)?.institution.parsers).toEqual([
      "other-bank-pdf",
    ]);
    expect(opening(ledger, created.id)).toEqual({
      date: "2026-08-02",
      amount: 10000,
    });
    expect(drafts(ledger, created.id)).toEqual([]);

    // Dropped again, the files are that account's, set up and empty.
    expect((await read(ledger, files())).accounts[0]).toMatchObject({
      status: "empty",
      account: { id: created.id },
    });
    expect(await add(ledger, files())).toEqual({
      ok: true,
      added: {
        account_id: created.id,
        account_name: "Sample Current",
        drafts: 2,
      },
    });
    expect(
      ledger.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM journal_entries WHERE account_id = ?",
        )
        .get(created.id),
    ).toEqual({ n: 1 });
  });

  it("refuses a file it can't read, and a new account with no name", async () => {
    const ledger = books();

    expect(await add(ledger, [dropped("NOPII.pdf", null)])).toMatchObject({
      ok: false,
      code: "statement_unreadable",
    });
    expect(
      await add(ledger, [dropped("NOPII-other.pdf", otherBank("08"))], {
        institution: "Other Sample Bank",
      }),
    ).toMatchObject({ ok: false, code: "invalid_fields" });
    expect(
      await add(ledger, [dropped("NOPII-other.pdf", otherBank("08"))], {
        institution: "Other Sample Bank",
        name: "Groceries",
      }),
    ).toMatchObject({ ok: false, code: "ledger_name_taken" });
  });

  it("refuses a group account from the chart as the bank", async () => {
    const ledger = books();

    expect(
      await add(ledger, [dropped("NOPII.pdf", otherBank("08"))], {
        institution: "Other Sample Bank",
        account_id: 1,
      }),
    ).toMatchObject({ ok: false, code: "account_has_children" });
    expect(presetOf(ledger, 1)).toBeNull();
  });

  it("checks the instructions a new account will get before making it", async () => {
    const ledger = books();
    mkdirSync(join(root, "user-config"));
    writeFileSync(
      join(root, "user-config", "custom_mappings_default.prompt"),
      "NOPII sample instructions\n",
    );
    // The default instructions can't be used.
    const broken: LoadCategorizer = async (settings) => ({
      classify: { ok: true, value: () => parseAccount("Groceries") },
      customMappings: settings.customMappingsFilenames.includes(
        "custom_mappings_default.prompt",
      )
        ? {
            ok: false,
            error: new CategorizationConfigError("NOPII prompt is broken."),
          }
        : { ok: true, value: "" },
      llm: settings.llm,
    });

    expect(
      await add(
        ledger,
        [dropped("NOPII.pdf", otherBank("08"))],
        { institution: "Other Sample Bank", name: "Sample Current" },
        broken,
      ),
    ).toMatchObject({ ok: false, code: "import_refused" });
    expect(ledgerAccount(ledger, "Sample Current")).toBeUndefined();
  });

  it("asks for the kind, the bank and the group only when it can't tell", async () => {
    const ledger = books();
    const bare = otherBank("08");
    const unnumbered = () => [
      dropped("NOPII.pdf", {
        ...bare,
        statement: { ...bare.statement, account: null },
      }),
    ];

    expect(
      await add(ledger, unnumbered(), {
        institution: "Other Sample Bank",
        name: "Sample Current",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_fields",
      error: "Say whether this is a bank account or a card.",
    });
    expect(
      await add(ledger, [dropped("NOPII-other.pdf", otherBank("08"))], {
        name: "Sample Current",
      }),
    ).toEqual({ ok: false, code: "invalid_fields", error: "Name the bank." });

    // No bank or card has a group to share yet.
    ledger.sqlite.exec("DELETE FROM import_presets");
    expect(
      await add(ledger, unnumbered(), {
        kind: "bank",
        institution: "Other Sample Bank",
        name: "Sample Current",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_fields",
      error: "Pick a group for it.",
    });
    expect(
      (
        await add(ledger, unnumbered(), {
          kind: "bank",
          institution: "Other Sample Bank",
          name: "Sample Current",
          parent_id: 1,
        })
      ).ok,
    ).toBe(true);
    expect(ledgerAccount(ledger, "Sample Current")).toMatchObject({
      parent_id: 1,
      account_type: "Asset",
    });
  });

  it("makes no account when the categorization config or Opening Balances would refuse", async () => {
    const ledger = books();
    const files = () => [dropped("NOPII.pdf", otherBank("08"))];
    const fields = { institution: "Other Sample Bank", name: "Sample Current" };
    const broken: LoadCategorizer = async (settings) => ({
      classify: {
        ok: false,
        error: new CategorizationConfigError("NOPII mappings file is broken."),
      },
      customMappings: { ok: true, value: "" },
      llm: settings.llm,
    });

    expect(await add(ledger, files(), fields, broken)).toMatchObject({
      ok: false,
      code: "import_refused",
      importError: { name: "CategorizationConfigError" },
    });
    expect(ledgerAccount(ledger, "Sample Current")).toBeUndefined();

    ledger.sqlite.exec(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (20, 'workspace', 'user', 'Opening Balances', 1, 'Asset', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    `);
    expect(await add(ledger, files(), fields)).toMatchObject({
      ok: false,
      code: "opening_balance_refused",
    });
    expect(ledgerAccount(ledger, "Sample Current")).toBeUndefined();
    expect(
      loadImportPresets(ledger.db, ledger.auth).map((one) => one.name),
    ).toEqual(["Sample Bank", "Sample Cards"]);
  });
});

describe("groupDrop", () => {
  const recognized = (
    file: string,
    fixture: { parsers: string[]; statement: object },
  ) =>
    ({
      outcome: "recognized",
      file,
      parserName: fixture.parsers[0],
      statement: fixture.statement,
    }) as Parameters<typeof groupDrop>[0][number];

  it("groups by the account the presets place, else by the number printed", () => {
    const presets = loadImportPresets(books().db, testLedgerAuth());
    const groups = groupDrop(
      [
        recognized("NOPII-aug.pdf", otherBank("08", { opening: 14000 })),
        recognized("NOPII-sav.xls", savings("08")),
        {
          outcome: "unrecognized",
          file: "NOPII.txt",
          candidateParserNames: [],
        },
        recognized("NOPII-jul.pdf", otherBank("07", { opening: 10000 })),
      ],
      presets,
    );

    expect(
      groups.map((one) => [
        one.key,
        one.accountId,
        one.statements.map((read) => read.file),
      ]),
    ).toEqual([
      ["new:bank:050505000099", null, ["NOPII-jul.pdf", "NOPII-aug.pdf"]],
      ["account:2", 2, ["NOPII-sav.xls"]],
    ]);
  });
});

describe("statementOpening", () => {
  const savingsWith = (more: Parameters<typeof statement>[1]) =>
    statement(monthRows("08"), more) as unknown as Parameters<
      typeof statementOpening
    >[0];

  it("is the statement's own opening, the day before its first row", () => {
    expect(statementOpening(savingsWith({ opening: 10000 }))).toEqual({
      date: "2026-08-02",
      amount: 10000,
    });
  });

  it("is the first printed balance less the rows up to it", () => {
    expect(statementOpening(savingsWith({ balances: [15000, 14000] }))).toEqual(
      { date: "2026-08-02", amount: 10000 },
    );
    expect(statementOpening(savingsWith({ balances: [null, 14000] }))).toEqual({
      date: "2026-08-02",
      amount: 10000,
    });
  });

  it("is the printed closing less every row, when that is all it prints", () => {
    expect(statementOpening(savingsWith({ closing: 14000 }))).toEqual({
      date: "2026-08-02",
      amount: 10000,
    });
  });

  it("has no amount when the statement prints no balance", () => {
    expect(statementOpening(savingsWith({}))).toEqual({
      date: "2026-08-02",
      amount: null,
    });
  });
});

describe("tidyBankName", () => {
  it("drops the company suffix and title-cases long all-caps words", () => {
    expect(tidyBankName("HDFC BANK Ltd.")).toBe("HDFC Bank");
    expect(tidyBankName("STANDARD CHARTERED BANK")).toBe(
      "Standard Chartered Bank",
    );
    expect(tidyBankName("SAMPLE BANK LIMITED")).toBe("Sample Bank");
    expect(tidyBankName("  ABC SAMPLE CARDS LTD, ")).toBe("ABC Sample Cards");
  });

  it("keeps short acronyms and mixed case, and lowers joining words", () => {
    expect(tidyBankName("THE SAMPLE BANK LTD")).toBe("The Sample Bank");
    expect(tidyBankName("STATE BANK OF SAMPLE")).toBe("State Bank of Sample");
    expect(tidyBankName("Sample Bank (NOPII) Ltd")).toBe("Sample Bank (Nopii)");
    expect(tidyBankName("ABC Sample Bank.")).toBe("ABC Sample Bank");
    expect(tidyBankName("")).toBe("");
  });
});
