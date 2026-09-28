import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import type { ChartAccount } from "../../shared/index.js";
import {
  STARTER_CHART,
  type ChartLlm,
  type GetClient,
} from "../modules/chart-of-accounts/index.js";
import { insertJournalPlan } from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  changeAccount,
  createChart,
  deleteChartAccount,
  loadChartOfAccounts,
  suggestChart,
} from "./chart-of-accounts.js";

function books(sql = ""): Ledger {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(sql);
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

// Every account by its name and type, with its parent's name, in id order.
function rows(
  ledger: Ledger,
): { name: string; account_type: string; parent: string | null }[] {
  return ledger.sqlite
    .prepare(
      `SELECT a.name, a.account_type, p.name AS parent
       FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id ORDER BY a.id`,
    )
    .all() as { name: string; account_type: string; parent: string | null }[];
}

const account = (
  name: string,
  account_type: ChartAccount["account_type"],
  parent: string | null = null,
): ChartAccount => ({ name, account_type, parent, note: null });

describe("loadChartOfAccounts", () => {
  it("offers the starter chart to books with no accounts", () => {
    const chart = loadChartOfAccounts(books());
    expect(chart.state).toBe("new");
    expect(chart.state === "new" && chart.starter.accounts).toEqual(
      STARTER_CHART,
    );
  });

  it("shows the books' own chart, parents by name, once there is any account", () => {
    const chart = loadChartOfAccounts(
      books(`
        INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
        VALUES (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '', ''),
               (2, 'workspace', 'user', 'Sample Savings', 1, 'Asset', '', ''),
               (3, 'workspace', 'other', 'Not Mine', NULL, 'Asset', '', '');
      `),
    );
    expect(chart).toEqual({
      state: "existing",
      chart: {
        accounts: [
          account("Assets", "Asset"),
          account("Sample Savings", "Asset", "Assets"),
        ],
      },
    });
  });
});

describe("createChart", () => {
  it("creates the chart parents first, in the request's scope", () => {
    const ledger = books();
    const chart = [
      account("Groceries", "Expense", "Expenses"),
      ...STARTER_CHART.filter((one) => one.parent === null),
      account("Opening Balances", "Equity", "Equity"),
    ];

    expect(createChart(ledger, chart)).toEqual({ ok: true, created: 7 });
    expect(rows(ledger)).toEqual([
      { name: "Assets", account_type: "Asset", parent: null },
      { name: "Liabilities", account_type: "Liability", parent: null },
      { name: "Equity", account_type: "Equity", parent: null },
      { name: "Opening Balances", account_type: "Equity", parent: "Equity" },
      { name: "Income", account_type: "Revenue", parent: null },
      { name: "Expenses", account_type: "Expense", parent: null },
      { name: "Groceries", account_type: "Expense", parent: "Expenses" },
    ]);
    expect(
      ledger.sqlite
        .prepare(
          "SELECT DISTINCT workspace_id, scoped_to_user_id FROM accounts",
        )
        .all(),
    ).toEqual([{ workspace_id: "workspace", scoped_to_user_id: "user" }]);
  });

  it("creates the whole starter chart", () => {
    const ledger = books();
    expect(createChart(ledger, STARTER_CHART)).toEqual({
      ok: true,
      created: STARTER_CHART.length,
    });
  });

  it("refuses books that have an account, and writes nothing", () => {
    const ledger = books(`
      INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (1, 'workspace', 'user', 'Cash', NULL, 'Asset', '', '');
    `);
    expect(createChart(ledger, STARTER_CHART)).toMatchObject({
      ok: false,
      code: "books_have_accounts",
    });
    expect(rows(ledger)).toHaveLength(1);
  });

  it("refuses a chart that breaks the rules", () => {
    const ledger = books();
    expect(createChart(ledger, [account("Assets", "Asset")])).toMatchObject({
      ok: false,
      code: "invalid_chart",
    });
    expect(rows(ledger)).toEqual([]);
  });
});

describe("suggestChart", () => {
  const llm = (client: GetClient): ChartLlm => ({
    name: "Sample Agent",
    caller: { ready: true, client },
  });

  it("sends the description and the chart on screen, and fixes the answer", async () => {
    const requests: unknown[] = [];
    const client: GetClient = {
      get: async (request) => {
        requests.push(request.input);
        return {
          ok: true,
          value: request.output.schema.parse({
            accounts: [
              account("Assets", "Asset"),
              account("Tuition", "Expense", "Children"),
            ],
          }),
        };
      },
    };
    const current = STARTER_CHART.slice(0, 3);

    const suggestion = await suggestChart(
      llm(client),
      "NOPII sample household",
      current,
    );

    expect(requests).toEqual([
      { description: "NOPII sample household", current },
    ]);
    expect(suggestion.ok).toBe(true);
    if (!suggestion.ok) return;
    expect(suggestion.proposal.accounts).toContainEqual(
      account("Tuition", "Expense", "Expenses"),
    );
    expect(suggestion.notes).toContain(
      "Tuition was under Children, which isn't in the chart; it is under Expenses now.",
    );
  });

  it("says why when nobody can answer, or the call failed", async () => {
    expect(
      await suggestChart(
        {
          name: "no coding agent",
          caller: { ready: false, reason: "No agent." },
        },
        "NOPII",
        [],
      ),
    ).toEqual({ ok: false, code: "llm_unavailable", error: "No agent." });
    expect(
      await suggestChart(
        llm({ get: async () => ({ ok: false, error: "timed out" }) }),
        "NOPII",
        [],
      ),
    ).toEqual({
      ok: false,
      code: "llm_failed",
      error: "Sample Agent couldn't propose accounts: timed out",
    });
  });
});

/*
 * One account at a time. Assets (1) holds Bank Accounts (2), which holds
 * Sample Savings (3) and Sample Wallet (4); Expenses (5) holds Groceries
 * (6); Equity (7) holds Opening Balances (8).
 */
const HOUSEHOLD_CHART = `
  INSERT INTO accounts
    (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
  VALUES
    (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '', ''),
    (2, 'workspace', 'user', 'Bank Accounts', 1, 'Asset', '', ''),
    (3, 'workspace', 'user', 'Sample Savings', 2, 'Asset', '', ''),
    (4, 'workspace', 'user', 'Sample Wallet', 2, 'Asset', '', ''),
    (5, 'workspace', 'user', 'Expenses', NULL, 'Expense', '', ''),
    (6, 'workspace', 'user', 'Groceries', 5, 'Expense', '', ''),
    (7, 'workspace', 'user', 'Equity', NULL, 'Equity', '', ''),
    (8, 'workspace', 'user', 'Opening Balances', 7, 'Equity', '', '');
`;

// One bank: Sample Savings (3) is a preset account, so its type follows the
// preset's `is_credit_card`.
const SAMPLE_BANK_PRESET = `
  INSERT INTO import_presets
    (id, workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
  VALUES
    (1, 'workspace', 'user', 'Sample Bank', '[]',
     '[{"account_id":3,"name":"Sample Savings","is_credit_card":false,"account_identifiers":[],"custom_mappings_filenames":[]}]',
     '2026-02-03T00:00:00Z');
`;

const household = () => books(HOUSEHOLD_CHART);

// One posted 1000 on `accountId`, against Assets (1) unless that is it.
function posted(ledger: Ledger, accountId: number) {
  const against = accountId === 1 ? 5 : 1;
  const line = {
    assertion: null,
    sourceReference: null,
    comment: null,
    sourceNarration: null,
  };
  insertJournalPlan(
    ledger.db,
    [
      {
        date: "2026-02-03",
        description: "NOPII TRANSFER",
        entries: [
          {
            ...line,
            account: accountId,
            amount: -1000,
            sourceTransactionKey: null,
          },
          {
            ...line,
            account: against,
            amount: 1000,
            sourceTransactionKey: null,
          },
        ],
      },
    ],
    ledger.auth,
  );
}

function drafted(ledger: Ledger, accountId: number) {
  ledger.sqlite
    .prepare(
      `INSERT INTO draft_transactions
         (workspace_id, scoped_to_user_id, date, source_narration, withdrawal,
          deposit, base_account_id, created_at, updated_at)
       VALUES ('workspace', 'user', '2026-02-03', 'NOPII TRANSFER', 0, 1000, ?, '2026-02-03T00:00:00Z', '2026-02-03T00:00:00Z')`,
    )
    .run(accountId);
}

describe("changeAccount", () => {
  const change = (
    ledger: Ledger,
    id: number,
    name: string,
    account_type: ChartAccount["account_type"],
    parent_id: number | null,
  ) => changeAccount(ledger, id, { name, account_type, parent_id });

  it("retypes a whole branch, keeping every account where it sat", () => {
    const ledger = household();

    const outcome = change(ledger, 2, "Current Accounts", "Expense", 5);

    expect(outcome).toMatchObject({ ok: true, moved: 2 });
    expect(outcome.ok && outcome.account).toMatchObject({
      id: 2,
      name: "Current Accounts",
      account_type: "Expense",
      parent_id: 5,
    });
    expect(rows(ledger)).toEqual([
      { name: "Assets", account_type: "Asset", parent: null },
      { name: "Current Accounts", account_type: "Expense", parent: "Expenses" },
      {
        name: "Sample Savings",
        account_type: "Expense",
        parent: "Current Accounts",
      },
      {
        name: "Sample Wallet",
        account_type: "Expense",
        parent: "Current Accounts",
      },
      { name: "Expenses", account_type: "Expense", parent: null },
      { name: "Groceries", account_type: "Expense", parent: "Expenses" },
      { name: "Equity", account_type: "Equity", parent: null },
      { name: "Opening Balances", account_type: "Equity", parent: "Equity" },
    ]);
  });

  it("retypes with entries posted on the branch", () => {
    const ledger = household();
    posted(ledger, 3);

    expect(change(ledger, 2, "Bank Accounts", "Expense", 5)).toMatchObject({
      ok: true,
      moved: 2,
    });

    expect(rows(ledger).slice(1, 4)).toEqual([
      { name: "Bank Accounts", account_type: "Expense", parent: "Expenses" },
      {
        name: "Sample Savings",
        account_type: "Expense",
        parent: "Bank Accounts",
      },
      {
        name: "Sample Wallet",
        account_type: "Expense",
        parent: "Bank Accounts",
      },
    ]);
    // The posted entry is still on Sample Savings, its amount untouched.
    expect(
      ledger.sqlite
        .prepare(
          "SELECT account_id, credit FROM journal_entries WHERE account_id = 3",
        )
        .all(),
    ).toEqual([{ account_id: 3, credit: 1000 }]);
  });

  it("changes one account with no sub-accounts", () => {
    const ledger = household();

    expect(change(ledger, 6, "Eating Out", "Revenue", null)).toMatchObject({
      ok: true,
      moved: 0,
    });
    expect(rows(ledger)[5]).toEqual({
      name: "Eating Out",
      account_type: "Revenue",
      parent: null,
    });
  });

  it("moves an account within its type", () => {
    const ledger = household();

    expect(change(ledger, 3, "Sample Savings", "Asset", 4)).toMatchObject({
      ok: true,
      moved: 0,
    });
    expect(rows(ledger)[2]).toEqual({
      name: "Sample Savings",
      account_type: "Asset",
      parent: "Sample Wallet",
    });
  });

  it("lets Opening Balances move within Equity", () => {
    const ledger = household();

    expect(change(ledger, 8, "Opening Balances", "Equity", null)).toMatchObject(
      { ok: true, moved: 0 },
    );
    expect(rows(ledger)[7]).toEqual({
      name: "Opening Balances",
      account_type: "Equity",
      parent: null,
    });
  });

  it("refuses each rule, and writes nothing", () => {
    const ledger = books(HOUSEHOLD_CHART + SAMPLE_BANK_PRESET);
    const before = rows(ledger);

    expect(change(ledger, 99, "Sample", "Asset", null)).toMatchObject({
      ok: false,
      problem: { code: "unknown_account", field: null },
    });
    expect(change(ledger, 3, "   ", "Asset", 2)).toMatchObject({
      ok: false,
      problem: { code: "name_required", field: "name" },
    });
    expect(change(ledger, 3, "Groceries", "Asset", 2)).toMatchObject({
      ok: false,
      problem: { code: "ledger_name_taken", field: "name" },
    });
    expect(change(ledger, 3, "Sample Savings", "Asset", 5)).toMatchObject({
      ok: false,
      problem: { code: "parent_not_suitable", field: "parent_id" },
    });
    expect(change(ledger, 3, "Sample Savings", "Asset", 99)).toMatchObject({
      ok: false,
      problem: { code: "parent_not_suitable", field: "parent_id" },
    });
    expect(change(ledger, 2, "Bank Accounts", "Asset", 3)).toMatchObject({
      ok: false,
      problem: { code: "parent_not_suitable", field: "parent_id" },
    });

    // Opening Balances keeps its name and stays Equity.
    expect(change(ledger, 8, "Opening Balance", "Equity", 7)).toMatchObject({
      ok: false,
      problem: { code: "opening_balances_fixed", field: "name" },
    });
    expect(change(ledger, 8, "Opening Balances", "Asset", 1)).toMatchObject({
      ok: false,
      problem: { code: "opening_balances_fixed", field: "account_type" },
    });

    // Sample Savings (3) is a preset account, so the branch holding it can't
    // change type; its name still can.
    expect(change(ledger, 2, "Bank Accounts", "Expense", 5)).toMatchObject({
      ok: false,
      problem: {
        code: "bank_or_card_type_fixed",
        field: "account_type",
        message:
          "Bank Accounts holds a bank or card, so its type follows theirs. Change them in Settings › Banks & cards.",
      },
    });
    expect(change(ledger, 3, "Sample Savings", "Revenue", null)).toMatchObject({
      ok: false,
      problem: {
        code: "bank_or_card_type_fixed",
        field: "account_type",
        message:
          "Sample Savings is a bank or card, so its type follows its statements. Change it in Settings › Banks & cards.",
      },
    });
    expect(rows(ledger)).toEqual(before);
  });

  it("allows renaming a branch that holds a bank account", () => {
    const ledger = books(HOUSEHOLD_CHART + SAMPLE_BANK_PRESET);

    expect(change(ledger, 2, "Current Accounts", "Asset", 1)).toMatchObject({
      ok: true,
      moved: 0,
    });
    expect(rows(ledger)[1]).toEqual({
      name: "Current Accounts",
      account_type: "Asset",
      parent: "Assets",
    });
  });
});

describe("deleteChartAccount", () => {
  it("deletes an account with nothing on it and nothing under it", () => {
    const ledger = household();

    expect(deleteChartAccount(ledger, 4)).toEqual({ ok: true });
    expect(rows(ledger).map((row) => row.name)).not.toContain("Sample Wallet");
  });

  it("refuses each blocker, naming what is in the way", () => {
    const ledger = books(HOUSEHOLD_CHART + SAMPLE_BANK_PRESET);

    expect(deleteChartAccount(ledger, 99)).toMatchObject({
      ok: false,
      problem: { code: "unknown_account" },
    });
    expect(deleteChartAccount(ledger, 2)).toMatchObject({
      ok: false,
      problem: {
        code: "has_sub_accounts",
        message:
          "Bank Accounts has 2 sub-accounts under it; delete them first.",
      },
    });
    expect(deleteChartAccount(ledger, 3)).toMatchObject({
      ok: false,
      problem: {
        code: "bank_or_card",
        message:
          "Sample Savings is a bank or card. Remove it in Settings › Banks & cards.",
      },
    });

    posted(ledger, 4);
    expect(deleteChartAccount(ledger, 4)).toMatchObject({
      ok: false,
      problem: {
        code: "has_entries",
        message: "Sample Wallet has 1 entry in your books.",
      },
    });
    drafted(ledger, 4);
    expect(deleteChartAccount(ledger, 4)).toMatchObject({
      ok: false,
      problem: { code: "has_entries" },
    });

    // Nothing was deleted.
    expect(rows(ledger)).toHaveLength(8);
  });

  it("refuses on drafts alone, after the entries are gone", () => {
    const ledger = household();
    drafted(ledger, 4);

    expect(deleteChartAccount(ledger, 4)).toMatchObject({
      ok: false,
      problem: {
        code: "has_drafts",
        message: "Sample Wallet has 1 draft to review.",
      },
    });
  });
});
