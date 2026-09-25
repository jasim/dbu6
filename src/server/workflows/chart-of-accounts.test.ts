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
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  createChart,
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

function rows(ledger: Ledger) {
  return ledger.sqlite
    .prepare(
      `SELECT a.name, a.account_type, p.name AS parent
       FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id ORDER BY a.id`,
    )
    .all();
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
