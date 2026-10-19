import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMigrations,
  connectProject,
  TsRestApi,
  type ProjectDbConnection,
  type SapportaEnv,
} from "@sapporta/server";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { parseAccount } from "../modules/values/index.js";

vi.mock("../modules/coding-agent/categorization-llm.js", () => ({
  categorizationLlm: async () => ({
    agent: null,
    name: "no coding agent",
    caller: { ready: false, reason: "No coding agent is installed." },
  }),
}));

import { loadDbu6App } from "../mount.js";
import { dbu6MigrationsDir } from "../paths.js";

/*
 * Run categorizer's routes over HTTP, in a project of its own: Sample
 * Savings (2) has two drafts without an account, which the stub rules send
 * to Groceries (5).
 */

const loadCategorizer: LoadCategorizer = async (settings) => ({
  classify: { ok: true, value: () => parseAccount("Groceries") },
  customMappings: { ok: true, value: "" },
  llm: settings.llm,
});

let root: string;
let conn: ProjectDbConnection;
let app: Hono<SapportaEnv>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-classify-drafts-"));
  vi.stubEnv("DBU6_ROOT", root);
  conn = connectProject(join(root, "sqlite.db"));
  applyMigrations(conn.sqlite, dbu6MigrationsDir());
  const now = "2026-09-01T00:00:00Z";
  conn.sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '${now}', '${now}'),
      (2, 'workspace', 'user', 'Sample Savings', 1, 'Asset', '${now}', '${now}'),
      (5, 'workspace', 'user', 'Groceries', NULL, 'Expense', '${now}', '${now}');
    INSERT INTO draft_transactions
      (id, workspace_id, scoped_to_user_id, date, account_id, source_narration,
       withdrawal, deposit, base_account_id, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', '2026-08-03', NULL, 'NOPII SAMPLE SHOP', 1000, 0, 2, '${now}', '${now}'),
      (2, 'workspace', 'user', '2026-08-04', NULL, 'NOPII SAMPLE MARKET', 2000, 0, 2, '${now}', '${now}');
  `);

  const api = new TsRestApi<SapportaEnv>();
  loadDbu6App(api, { loadCategorizer });
  app = new Hono<SapportaEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", testLedgerAuth());
    c.set("db", conn.db);
    c.set("sqlite", conn.sqlite);
    await next();
  });
  app.route("/", api);
});

afterEach(() => {
  conn.sqlite.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("a classification's progress", () => {
  it("is there while the run goes, and done a while after it answers", async () => {
    const response = await app.request("/draft-transactions/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: [1, 2],
        progress_id: "sample-progress-050505",
      }),
    });
    expect(response.status).toBe(200);
    const after = await app.request(
      "/draft-transactions/classify/progress/sample-progress-050505",
    );
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({
      stage: "done",
      rows: [
        {
          date: "2026-08-03",
          narration: "NOPII SAMPLE SHOP",
          amount: expect.any(Number),
          direction: "out",
          account: "Groceries",
          by: "rule",
        },
        {
          date: "2026-08-04",
          narration: "NOPII SAMPLE MARKET",
          amount: expect.any(Number),
          direction: "out",
          account: "Groceries",
          by: "rule",
        },
      ],
    });
  });

  it("is not there for a run sent without a progress id", async () => {
    await app.request("/draft-transactions/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [1, 2] }),
    });
    const after = await app.request(
      "/draft-transactions/classify/progress/sample-progress-050505",
    );
    expect(after.status).toBe(404);
  });
});
