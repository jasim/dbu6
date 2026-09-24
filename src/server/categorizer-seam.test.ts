import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyMigrations,
  connectProject,
  TsRestApi,
  type ProjectDbConnection,
  type SapportaEnv,
} from "@sapporta/server";
import { parsePlainDate } from "@sapporta/shared/temporal";
import type {
  CategorizerSettings,
  LoadCategorizer,
} from "./modules/categorization/index.js";
import { testLedgerAuth } from "./modules/ledger-sql/testing.js";
import { parseAccount } from "./modules/values/index.js";
import { loadDbu6App } from "./mount.js";
import { dbu6MigrationsDir, packageDir } from "./paths.js";
import { accountsTable } from "./schema/accounts.js";
import { draftTransactionsTable } from "./schema/draft-journals.js";
import { importPresetsTable } from "./schema/import-presets.js";

// The engine would detect this machine's coding agents. The stand-in
// categorizer places every row by rule, so the LLM is never asked.
vi.mock("./modules/coding-agent/categorization-llm.js", () => ({
  categorizationLlm: async () => ({
    agent: null,
    name: "no engine in tests",
    caller: { ready: false, reason: "no engine in tests" },
  }),
}));

// The three workflows that categorize run for real, over HTTP, on a database
// migrated with our migrations. The project has no transaction_mappings.mjs,
// so a draft can only reach "Sample Dining" through the categorizer the
// runtime was given.
const CATEGORY = "Sample Dining";
const BANK = "Sample Bank";
const CARD = "Sample Card";
const BANK_PARSER = "hdfc-bank-xls";

const loadedWith: CategorizerSettings[] = [];
const loadCategorizer: LoadCategorizer = async (settings) => {
  loadedWith.push(settings);
  return {
    classify: { ok: true, value: () => parseAccount(CATEGORY) },
    customMappings: { ok: true, value: "" },
    llm: settings.llm,
  };
};

let root: string;
let conn: ProjectDbConnection;
let app: Hono<SapportaEnv>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-categorizer-seam-"));
  vi.stubEnv("DBU6_ROOT", root);
  mkdirSync(join(root, "user-config"));

  conn = connectProject(join(root, "sqlite.db"));
  applyMigrations(conn.sqlite, dbu6MigrationsDir());
  const account = (
    id: number,
    name: string,
    account_type: typeof accountsTable.$inferInsert.account_type,
  ) => ({
    id,
    workspace_id: "workspace",
    scoped_to_user_id: "user",
    name,
    account_type,
  });
  conn.db
    .insert(accountsTable)
    .values([
      account(1, BANK, "Asset"),
      account(2, CARD, "Liability"),
      account(3, CATEGORY, "Expense"),
    ])
    .run();
  // The bank's import preset, whose one account imports into account 1.
  conn.db
    .insert(importPresetsTable)
    .values({
      workspace_id: "workspace",
      scoped_to_user_id: "user",
      name: "Sample HDFC",
      parsers: JSON.stringify([BANK_PARSER]),
      accounts: JSON.stringify([
        {
          account_id: 1,
          name: BANK,
          is_credit_card: false,
          account_identifiers: ["05050505050505"],
          custom_mappings_filenames: ["sample_mappings.prompt"],
        },
      ]),
    })
    .run();

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

afterAll(() => {
  conn.sqlite.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function draftAccounts(where: string): (number | null)[] {
  return conn.sqlite
    .prepare(`SELECT account_id FROM draft_transactions WHERE ${where}`)
    .pluck()
    .all() as (number | null)[];
}

describe("the runtime's loadCategorizer", () => {
  it("categorizes a statement import", async () => {
    loadedWith.length = 0;
    const form = new FormData();
    form.append(
      "files",
      new File(
        [
          readFileSync(
            packageDir(
              `custom-built-parsers/${BANK_PARSER}/fixtures/sanitized-statement.xls`,
            ),
          ),
        ],
        "sample-bank.xls",
      ),
    );

    const response = await app.request("/import-draft/statements/auto", {
      method: "POST",
      body: form,
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(loadedWith.map((one) => one.customMappingsFilenames)).toEqual([
      ["sample_mappings.prompt"],
    ]);
    const placed = draftAccounts("base_account_id = 1");
    expect(placed.length).toBeGreaterThan(0);
    expect(new Set(placed)).toEqual(new Set([3]));
  }, 120_000);

  it("categorizes a freeform import", async () => {
    loadedWith.length = 0;
    const response = await app.request("/import-draft/abacus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_account: CARD,
        is_credit_card: true,
        source_name: "sample-card",
        statement: {
          kind: "abacus",
          institution: "Sample Bank",
          opening: -2500,
          closing: -3500,
          rows: [
            {
              date: "2026-09-03",
              narration: "NOPII SAMPLE MERCHANT ONE",
              withdrawal: 1000,
              deposit: 0,
              balance: null,
            },
          ],
        },
      }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(loadedWith.map((one) => one.customMappingsFilenames)).toEqual([[]]);
    expect(draftAccounts("base_account_id = 2")).toEqual([3]);
  });

  it("categorizes a reclassification", async () => {
    loadedWith.length = 0;
    const { id } = conn.db
      .insert(draftTransactionsTable)
      .values({
        workspace_id: "workspace",
        scoped_to_user_id: "user",
        date: parsePlainDate("2026-09-04"),
        narration: "NOPII SAMPLE MERCHANT TWO",
        withdrawal: 500,
        deposit: 0,
        account_id: null,
        base_account_id: 2,
        balance_assertion_base_account: null,
      })
      .returning({ id: draftTransactionsTable.id })
      .get();

    const response = await app.request("/draft-transactions/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: [id],
        custom_mappings_filenames: ["sample_mappings.prompt"],
      }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(loadedWith.map((one) => one.customMappingsFilenames)).toEqual([
      ["sample_mappings.prompt"],
    ]);
    expect(draftAccounts(`id = ${id}`)).toEqual([3]);
  });
});
