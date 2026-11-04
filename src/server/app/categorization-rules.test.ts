import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SapportaEnv } from "@sapporta/server";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import categorizationRulesApi from "./categorization-rules.js";

const SCOPE = "'workspace', 'user'";
const AT = "'', ''";

/*
 * Sample Savings (1) pays Sample Card (2). The books hold a one-row journal
 * per statement row, and a grouped journal from before 2026-09-24 whose
 * one statement line stands beside several categorized lines.
 */
function books() {
  const sqlite = new Database(":memory:");
  migrate(drizzle(sqlite), { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, account_type, created_at, updated_at) VALUES
      (1, ${SCOPE}, 'Sample Savings', 'Asset', ${AT}),
      (2, ${SCOPE}, 'Sample Card', 'Liability', ${AT}),
      (3, ${SCOPE}, 'Eating Out', 'Expense', ${AT}),
      (4, ${SCOPE}, 'Groceries', 'Expense', ${AT});
    INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at) VALUES
      (10, ${SCOPE}, '2026-01-05', 'Card bill', ${AT}),
      (11, ${SCOPE}, '2026-01-06', 'Card bill', ${AT}),
      (12, ${SCOPE}, '2025-06-30', 'Expenses', ${AT});
    INSERT INTO journal_entries (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, source_narration, created_at, updated_at) VALUES
      -- On the savings statement: money out to the card.
      (101, ${SCOPE}, 10, 2, 5000, 0, 'BILLPAY SAMPLE CARD 050505', ${AT}),
      (102, ${SCOPE}, 10, 1, 0, 5000, NULL, ${AT}),
      -- On the card's statement: money in from the savings account.
      (111, ${SCOPE}, 11, 2, 5000, 0, NULL, ${AT}),
      (112, ${SCOPE}, 11, 1, 0, 5000, 'CREDIT CARD PAYMENT NET BANKING', ${AT}),
      -- Grouped: three card spends, two at the cafe, beside one card line.
      (121, ${SCOPE}, 12, 3, 300, 0, 'SAMPLEFOOD 050505', ${AT}),
      (122, ${SCOPE}, 12, 3, 700, 0, 'SAMPLEFOOD 050506', ${AT}),
      (123, ${SCOPE}, 12, 4, 900, 0, 'NOPII GROCER', ${AT}),
      (124, ${SCOPE}, 12, 2, 0, 1900, NULL, ${AT});
    INSERT INTO draft_transactions (id, workspace_id, scoped_to_user_id, date, account_id, source_narration, withdrawal, deposit, base_account_id, balance_assertion_base_account, created_at, updated_at) VALUES
      (20, ${SCOPE}, '2026-02-01', NULL, 'SAMPLEFOOD 050507', 400, 0, 2, NULL, ${AT}),
      (21, ${SCOPE}, '2026-02-02', 4, 'SAMPLEFOOD MART', 2000, 0, 1, NULL, ${AT}),
      (22, ${SCOPE}, '2026-02-03', NULL, 'BILLPAY SAMPLE CARD 050508', 6000, 0, 1, NULL, ${AT});
  `);
  const app = new Hono<SapportaEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", testLedgerAuth());
    c.set("db", drizzle(sqlite) as never);
    c.set("sqlite", sqlite);
    await next();
  });
  app.route("/", categorizationRulesApi);
  return async (rule: unknown) => {
    const response = await app.request("/categorization-rules/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule }),
    });
    return { status: response.status, body: await response.json() };
  };
}

describe("POST /categorization-rules/preview", () => {
  it("counts what a rule catches per statement, in the drafts and the books, and where it sits now", async () => {
    const preview = books();
    expect(
      await preview({
        statement: "*",
        money: "out",
        contains: ["SAMPLEFOOD"],
        mapToAccount: "Eating Out",
      }),
    ).toEqual({
      status: 200,
      body: {
        statements: [
          {
            statement: "Sample Card",
            drafts: 1,
            posted: 2,
            least: 300,
            most: 700,
            now_in: [
              { account: "Eating Out", count: 2 },
              { account: null, count: 1 },
            ],
          },
          {
            statement: "Sample Savings",
            drafts: 1,
            posted: 0,
            least: 2000,
            most: 2000,
            now_in: [{ account: "Groceries", count: 1 }],
          },
        ],
      },
    });
  });

  it("reads a posted row's money from its statement's side", async () => {
    const preview = books();
    const billOut = await preview({
      statement: "Sample Savings",
      money: "out",
      contains: ["BILLPAY SAMPLE CARD"],
      mapToAccount: "Sample Card",
    });
    expect(billOut.body.statements).toEqual([
      {
        statement: "Sample Savings",
        drafts: 1,
        posted: 1,
        least: 5000,
        most: 6000,
        now_in: [
          { account: null, count: 1 },
          { account: "Sample Card", count: 1 },
        ],
      },
    ]);
    const cardIn = await preview({
      statement: "Sample Card",
      money: "in",
      narrations: ["CREDIT CARD PAYMENT NET BANKING"],
      mapToAccount: "Groceries",
    });
    expect(cardIn.body.statements).toMatchObject([
      { statement: "Sample Card", posted: 1 },
    ]);
    const cardOut = await preview({
      statement: "Sample Card",
      money: "out",
      narrations: ["CREDIT CARD PAYMENT NET BANKING"],
      mapToAccount: "Groceries",
    });
    expect(cardOut.body.statements).toEqual([]);
  });

  it("refuses what the file would refuse", async () => {
    const preview = books();
    const selfMapping = await preview({
      statement: "Sample Card",
      money: "in",
      contains: ["PAYMENT"],
      mapToAccount: "Sample Card",
    });
    expect(selfMapping.status).toBe(422);
    expect(selfMapping.body.error).toContain("own statement");
    const unknownStatement = await preview({
      statement: "Sample Savng",
      money: "out",
      contains: ["SAMPLEFOOD"],
      mapToAccount: "Eating Out",
    });
    expect(unknownStatement.status).toBe(422);
    expect(unknownStatement.body.error).toContain(
      '"Sample Savng", which is not an account in the books',
    );
  });

  it("answers a body not in the file's shape with a 400", async () => {
    const noStatement = await books()({
      money: "in",
      contains: ["PAYMENT"],
      mapToAccount: "Groceries",
    });
    expect(noStatement.status).toBe(400);
    expect(noStatement.body.code).toBe("BAD_REQUEST");
  });
});
