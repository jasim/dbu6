import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SapportaEnv } from "@sapporta/server";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import accountsApi from "./accounts.js";

/*
 * /api/accounts/:id over HTTP: the statuses and the 422 bodies the Accounts
 * page's form and coding agents read. The rules themselves are tested in
 * workflows/chart-of-accounts.test.ts.
 */

/* Assets (1) > Bank Accounts (2) > Sample Savings (3), Sample Wallet (4). */
function books() {
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
      (3, 'workspace', 'user', 'Sample Savings', 2, 'Asset', '', ''),
      (4, 'workspace', 'user', 'Sample Wallet', 2, 'Asset', '', ''),
      (5, 'workspace', 'user', 'Expenses', NULL, 'Expense', '', '');
  `);

  const app = new Hono<SapportaEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", testLedgerAuth());
    c.set("db", db as never);
    c.set("sqlite", sqlite);
    await next();
  });
  app.route("/", accountsApi);

  const change = (id: number, body: Record<string, unknown>) =>
    app.request(`/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const remove = (id: number) =>
    app.request(`/accounts/${id}`, { method: "DELETE" });

  return { sqlite, change, remove };
}

describe("PUT /api/accounts/:id", () => {
  it("renames, retypes and moves one account, taking its branch", async () => {
    const { change } = books();

    const response = await change(2, {
      name: "Current Accounts",
      account_type: "Expense",
      parent_id: 5,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      account: {
        id: 2,
        name: "Current Accounts",
        account_type: "Expense",
        parent_id: 5,
      },
      moved: 2,
    });
  });

  it("answers a refusal with its code and the field it is about", async () => {
    const { change } = books();

    const taken = await change(3, {
      name: "Sample Wallet",
      account_type: "Asset",
      parent_id: 2,
    });
    expect(taken.status).toBe(422);
    expect(await taken.json()).toEqual({
      error: "Your books already have an account named Sample Wallet.",
      code: "ledger_name_taken",
      field: "name",
    });

    const missing = await change(99, {
      name: "Sample",
      account_type: "Asset",
      parent_id: null,
    });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toEqual({
      error: "Your books no longer have that account.",
      code: "unknown_account",
      field: null,
    });
  });
});

describe("DELETE /api/accounts/:id", () => {
  it("deletes an empty account with nothing to say", async () => {
    const { remove } = books();

    const response = await remove(4);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("answers a refusal with its code", async () => {
    const { remove } = books();

    const response = await remove(2);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Bank Accounts has 2 sub-accounts under it; delete them first.",
      code: "has_sub_accounts",
    });
  });
});
