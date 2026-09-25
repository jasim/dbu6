import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatementAccountChange } from "../../shared/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  changeStatementAccount,
  loadStatementAccounts,
} from "./import-presets.js";
import { recordOpeningBalance } from "./opening-balances.js";

/*
 * The setup wizard's banks and cards: each one a ledger account and a preset
 * entry, written together. Assets (1) has Bank Accounts (2) and Cash (7)
 * under it, Liabilities (3) has Credit Cards (4), and Expenses (5) has
 * Groceries (6). user-config/ has the default instructions file.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-statement-accounts-"));
  mkdirSync(join(root, "user-config"));
  writeFileSync(
    join(root, "user-config", "custom_mappings_default.prompt"),
    "NOPII sample instructions\n",
  );
  vi.stubEnv("DBU6_ROOT", root);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function books(): Ledger {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '', ''),
      (2, 'workspace', 'user', 'Bank Accounts', 1, 'Asset', '', ''),
      (3, 'workspace', 'user', 'Liabilities', NULL, 'Liability', '', ''),
      (4, 'workspace', 'user', 'Credit Cards', 3, 'Liability', '', ''),
      (5, 'workspace', 'user', 'Expenses', NULL, 'Expense', '', ''),
      (6, 'workspace', 'user', 'Groceries', 5, 'Expense', '', ''),
      (7, 'workspace', 'user', 'Cash', 1, 'Asset', '', '');
  `);
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

const savings = (
  extra: Partial<Extract<StatementAccountChange, { action: "create" }>> = {},
): StatementAccountChange => ({
  action: "create",
  kind: "bank",
  institution: "Sample Bank",
  identifier: "0505 0500 0012",
  ledger: { source: "new", name: "Sample Savings", parent_id: 2 },
  ...extra,
});

async function created(ledger: Ledger, change = savings()) {
  const outcome = await changeStatementAccount(ledger, change);
  if (!outcome.ok) throw new Error(outcome.problem.message);
  return outcome.accounts;
}

function ledgerRow(ledger: Ledger, name: string) {
  return ledger.sqlite
    .prepare(
      "SELECT id, name, parent_id, account_type FROM accounts WHERE name = ?",
    )
    .get(name);
}

describe("creating a bank or card", () => {
  it("makes the ledger account and its preset entry together", async () => {
    const ledger = books();
    const accounts = await created(ledger);

    expect(ledgerRow(ledger, "Sample Savings")).toEqual({
      id: 8,
      name: "Sample Savings",
      parent_id: 2,
      account_type: "Asset",
    });
    expect(loadImportPresets(ledger.db, ledger.auth)).toEqual([
      {
        id: expect.any(Number),
        name: "Sample Bank",
        parsers: [],
        accounts: [
          {
            account_id: 8,
            name: "Sample Savings",
            is_credit_card: false,
            account_identifiers: ["050505000012"],
            custom_mappings_filenames: ["custom_mappings_default.prompt"],
          },
        ],
      },
    ]);
    expect(accounts.accounts).toEqual([
      {
        account_id: 8,
        name: "Sample Savings",
        kind: "bank",
        institution: "Sample Bank",
        account_identifiers: ["050505000012"],
        parent: { id: 2, name: "Bank Accounts" },
        in_ledger: true,
        entries: 0,
        drafts: 0,
      },
    ]);
    expect(accounts.default_parents).toEqual({ bank: 2, card: null });
    expect(accounts.mixed_parents).toEqual({ bank: false, card: false });
  });

  it("starts a new one under the parent most of its kind share", async () => {
    const ledger = books();
    // The first bank account sits under Cash, the next two under Bank
    // Accounts: the first listed doesn't decide.
    await created(
      ledger,
      savings({
        ledger: { source: "new", name: "Sample Wallet", parent_id: 7 },
      }),
    );
    await created(
      ledger,
      savings({
        institution: "Sample Bank Two",
        identifier: null,
        ledger: { source: "new", name: "Sample Savings", parent_id: 2 },
      }),
    );
    const accounts = await created(
      ledger,
      savings({
        institution: "Sample Bank Three",
        identifier: null,
        ledger: { source: "new", name: "Sample Current", parent_id: 2 },
      }),
    );

    expect(accounts.default_parents).toEqual({ bank: 2, card: null });
    expect(accounts.mixed_parents).toEqual({ bank: true, card: false });
  });

  it("takes the ledger account back out when the presets refuse", async () => {
    const ledger = books();
    await created(ledger);

    const outcome = await changeStatementAccount(
      ledger,
      savings({
        identifier: null,
        ledger: { source: "new", name: "Sample Current", parent_id: 2 },
      }),
    );

    expect(outcome).toMatchObject({
      ok: false,
      problem: {
        code: "account_identifier_required",
        message:
          "Sample Bank has two accounts, so each needs its number, and Sample Current has none.",
      },
    });
    expect(ledgerRow(ledger, "Sample Current")).toBeUndefined();
  });

  it("refuses a number, a parent or a name that doesn't fit", async () => {
    const ledger = books();
    const refusal = async (change: StatementAccountChange) => {
      const outcome = await changeStatementAccount(ledger, change);
      return outcome.ok ? null : outcome.problem.code;
    };

    expect(await refusal(savings({ identifier: "050505XX0505" }))).toBe(
      "identifier_invalid",
    );
    expect(
      await refusal(
        savings({ ledger: { source: "new", name: "Sample", parent_id: 4 } }),
      ),
    ).toBe("parent_not_suitable");
    expect(
      await refusal(
        savings({ ledger: { source: "new", name: "Groceries", parent_id: 2 } }),
      ),
    ).toBe("ledger_name_taken");
    expect(loadImportPresets(ledger.db, ledger.auth)).toEqual([]);
  });

  it("lists an account already in the books, once", async () => {
    const ledger = books();
    const accounts = await created(
      ledger,
      savings({
        identifier: null,
        ledger: { source: "existing", account_id: 7 },
      }),
    );

    expect(accounts.accounts.map((row) => row.name)).toEqual(["Cash"]);
    expect(accounts.unlisted.map((row) => row.name)).toEqual([
      "Assets",
      "Bank Accounts",
      "Liabilities",
      "Credit Cards",
    ]);
    const again = await changeStatementAccount(
      ledger,
      savings({
        institution: "Other Bank",
        ledger: { source: "existing", account_id: 7 },
      }),
    );
    expect(again).toMatchObject({
      ok: false,
      problem: { code: "account_not_suitable" },
    });
  });
});

describe("changing a bank or card", () => {
  it("moves a bank account to a card at another institution", async () => {
    const ledger = books();
    await created(ledger);

    const outcome = await changeStatementAccount(ledger, {
      action: "update",
      account_id: 8,
      kind: "card",
      institution: "Sample Cards",
      name: "Sample Card",
      identifier: "050505xxxxxx0505",
      parent_id: 4,
    });

    expect(outcome.ok).toBe(true);
    expect(ledgerRow(ledger, "Sample Card")).toEqual({
      id: 8,
      name: "Sample Card",
      parent_id: 4,
      account_type: "Liability",
    });
    expect(
      loadImportPresets(ledger.db, ledger.auth).map((institution) => [
        institution.name,
        institution.accounts,
      ]),
    ).toEqual([
      ["Sample Bank", []],
      [
        "Sample Cards",
        [
          {
            account_id: 8,
            name: "Sample Card",
            is_credit_card: true,
            account_identifiers: ["050505XXXXXX0505"],
            custom_mappings_filenames: ["custom_mappings_default.prompt"],
          },
        ],
      ],
    ]);
  });

  it("refuses once a draft or an entry is on the account", async () => {
    const ledger = books();
    await created(ledger);
    ledger.sqlite.exec(`
      INSERT INTO draft_transactions
        (workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit,
         account_id, base_account_id, created_at, updated_at)
      VALUES ('workspace', 'user', '2026-02-03', 'NOPII groceries', 100, 0, 6, 8, '', '');
    `);

    expect((await loadStatementAccounts(ledger)).accounts[0]).toMatchObject({
      entries: 0,
      drafts: 1,
    });
    for (const change of [
      { action: "remove", account_id: 8, delete_account: true },
      {
        action: "update",
        account_id: 8,
        kind: "bank",
        institution: "Sample Bank",
        name: "Renamed",
        identifier: null,
        parent_id: 2,
      },
    ] satisfies StatementAccountChange[]) {
      expect(await changeStatementAccount(ledger, change)).toMatchObject({
        ok: false,
        problem: {
          code: "account_has_transactions",
          message:
            "Sample Savings has transactions to review. Delete them in Review to change it here.",
        },
      });
    }
    // Once one is in the books, only the Accounts page and the presets
    // change it.
    ledger.sqlite.exec(`DELETE FROM draft_transactions;`);
    recordOpeningBalance(ledger, {
      accountId: 8,
      date: "2026-01-31",
      amount: 1000,
    });
    expect(
      await changeStatementAccount(ledger, {
        action: "remove",
        account_id: 8,
        delete_account: false,
      }),
    ).toMatchObject({
      ok: false,
      problem: {
        code: "account_has_transactions",
        message: "Sample Savings has transactions, so it can't change here.",
      },
    });
    expect(
      await changeStatementAccount(ledger, {
        action: "remove",
        account_id: 99,
        delete_account: false,
      }),
    ).toMatchObject({
      ok: false,
      problem: {
        code: "unknown_account",
        message: "That bank or card isn't set up any more.",
      },
    });
    expect(ledgerRow(ledger, "Sample Savings")).toBeDefined();
  });
});

describe("removing a bank or card", () => {
  it("takes it out of its preset, and out of the books when asked", async () => {
    const ledger = books();
    await created(ledger);
    await created(
      ledger,
      savings({
        institution: "Other Bank",
        ledger: { source: "new", name: "Other Savings", parent_id: 2 },
      }),
    );

    await changeStatementAccount(ledger, {
      action: "remove",
      account_id: 8,
      delete_account: true,
    });
    const accounts = await changeStatementAccount(ledger, {
      action: "remove",
      account_id: 9,
      delete_account: false,
    });

    expect(accounts.ok && accounts.accounts.accounts).toEqual([]);
    expect(ledgerRow(ledger, "Sample Savings")).toBeUndefined();
    expect(ledgerRow(ledger, "Other Savings")).toBeDefined();
  });

  it("keeps an account with accounts under it in the books", async () => {
    const ledger = books();
    await created(
      ledger,
      savings({
        identifier: null,
        ledger: { source: "existing", account_id: 1 },
      }),
    );

    expect(
      await changeStatementAccount(ledger, {
        action: "remove",
        account_id: 1,
        delete_account: true,
      }),
    ).toMatchObject({ ok: false, problem: { code: "account_has_children" } });
  });
});
