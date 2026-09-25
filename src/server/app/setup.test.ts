import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

// The parsers are stubbed: these tests are about where the staged statement
// goes. Every parser exists.
const { recognizeStatementFile } = vi.hoisted(() => ({
  recognizeStatementFile: vi.fn(),
}));
vi.mock("../modules/statement-sources/index.js", async (importActual) => ({
  ...(await importActual<object>()),
  recognizeStatementFile,
  savedCustomStatementParserNames: async () => ["sample-bank-xls"],
  parserDirectory: async (name: string) => `/sample/parsers/${name}`,
}));
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
 * The first statements step over HTTP, in a project of its own: a statement
 * stays staged from its upload until it is imported, and a failed import
 * keeps it for "Try again". Sample Savings (2) is Sample Bank's one account.
 */

const loadCategorizer: LoadCategorizer = async (settings) => ({
  classify: { ok: true, value: () => parseAccount("Groceries") },
  customMappings: { ok: true, value: "" },
  llm: settings.llm,
});

const STAGED = "tmp/statement-uploads/setup-sample-2/NOPII.xls";

let root: string;
let conn: ProjectDbConnection;
let app: Hono<SapportaEnv>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-first-statement-"));
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
    INSERT INTO import_presets
      (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
    VALUES ('workspace', 'user', 'Sample Bank', '[]',
      '[{"account_id":2,"name":"Sample Savings","is_credit_card":false,"account_identifiers":[],"custom_mappings_filenames":[]}]',
      '${now}');
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

// 5,000 in and 1,000 out in August, from an opening of 10,000; the closing
// the statement prints is `closing`.
function statement(closing: number | null) {
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
          balance: null,
        },
        {
          date: "2026-08-10",
          narration: "NOPII GROCERIES",
          withdrawal: 1000,
          deposit: 0,
          balance: null,
        },
      ],
      opening: 10000,
      closing,
      account: { kind: "bank", identifier: "050505000012" },
      institution: "SAMPLE BANK LTD",
    },
  };
}

async function upload() {
  const form = new FormData();
  form.append("account_id", "2");
  form.append("file", new File(["NOPII"], "NOPII.xls"));
  return app.request("/setup/sample-statement", { method: "POST", body: form });
}

function importIt(body: object = { account_id: 2 }) {
  return app.request("/setup/first-statement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function statuses() {
  const response = await app.request("/setup/first-statements");
  const body = (await response.json()) as { accounts: { status: string }[] };
  return body.accounts.map((row) => row.status);
}

describe("a first statement", () => {
  it("stays staged once read, and goes when it is imported", async () => {
    recognizeStatementFile.mockResolvedValue(statement(14000));

    const read = await upload();
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      outcome: "recognized",
      transactions: 2,
      opening: { date: "2026-08-02", amount: 10000 },
    });
    expect(existsSync(join(root, STAGED))).toBe(true);
    expect(await statuses()).toEqual(["read"]);

    const imported = await importIt();

    expect(imported.status, await imported.clone().text()).toBe(200);
    const body = (await imported.json()) as {
      files: { saved_path: string | null }[];
      groups: { result: { draft_transaction_count: number } }[];
    };
    expect(body.files.map((file) => file.saved_path)).toEqual([null]);
    expect(body.groups[0].result.draft_transaction_count).toBe(2);
    expect(existsSync(join(root, STAGED))).toBe(false);
    expect(await statuses()).toEqual(["imported"]);
  });

  it("stays staged for another try when the import fails", async () => {
    recognizeStatementFile.mockResolvedValue(statement(20000));
    await upload();

    const failed = await importIt();

    expect(failed.status).toBe(422);
    expect(await failed.json()).toMatchObject({
      error: "balance_mismatch",
      files: [{ saved_path: STAGED }],
    });
    expect(existsSync(join(root, STAGED))).toBe(true);
    expect(await statuses()).toEqual(["read"]);
  });

  it("says why it can't be imported, in the refusal's own code", async () => {
    expect(await (await importIt()).json()).toMatchObject({
      code: "no_staged_statement",
    });

    recognizeStatementFile.mockResolvedValue({
      ...statement(null),
      statement: { ...statement(null).statement, opening: null },
    });
    await upload();
    const refused = await importIt();
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      code: "opening_balance_needed",
    });

    expect(
      (await importIt({ account_id: 2, opening_amount: 10000 })).status,
    ).toBe(200);
  });
});
