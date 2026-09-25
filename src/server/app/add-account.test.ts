import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

// The parsers are stubbed: these tests are about the requests, the replies
// and where the dropped files go. Every parser exists; a file's name says
// what it is (`uploadName` keeps it, after the batch's index).
const { recognizeStatementFile } = vi.hoisted(() => ({
  recognizeStatementFile: vi.fn(),
}));
vi.mock("../modules/statement-sources/index.js", async (importActual) => ({
  ...(await importActual<object>()),
  recognizeStatementFile,
  savedCustomStatementParserNames: async () => [
    "other-bank-pdf",
    "sample-bank-xls",
  ],
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
 * /add over HTTP, in a project of its own. Sample Savings (2) is Sample
 * Bank's one account, read by sample-bank-xls; no preset lists
 * other-bank-pdf.
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
  root = mkdtempSync(join(tmpdir(), "dbu6-add-account-"));
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
      (3, 'workspace', 'user', 'Liabilities', NULL, 'Liability', '${now}', '${now}'),
      (5, 'workspace', 'user', 'Groceries', NULL, 'Expense', '${now}', '${now}');
    INSERT INTO import_presets
      (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
    VALUES ('workspace', 'user', 'Sample Bank', '["sample-bank-xls"]',
      '[{"account_id":2,"name":"Sample Savings","is_credit_card":false,"account_identifiers":[],"custom_mappings_filenames":[]}]',
      '${now}');
  `);

  recognizeStatementFile.mockReset();
  recognizeStatementFile.mockImplementation(
    async (parsers: string[], path: string) => {
      const name = basename(path).replace(/^\d+-/, "");
      const [parser] = name.startsWith("savings")
        ? ["sample-bank-xls"]
        : name.startsWith("other")
          ? ["other-bank-pdf"]
          : [];
      if (parser === undefined || !parsers.includes(parser)) {
        return { outcome: "unrecognized", candidateParserNames: parsers };
      }
      // "other-mar" opens at 16,000, every other statement at 10,000;
      // "other-bad" says it closed 1,000 higher than its rows reach.
      const month = /-(\w{3})\./.exec(name)?.[1] ?? "aug";
      const read = statement(
        MONTHS[month] ? month : "aug",
        month === "mar" ? 16000 : 10000,
        parser,
      );
      return {
        outcome: "recognized",
        parserName: parser,
        statement:
          month === "bad" ? { ...read, closing: read.closing + 1000 } : read,
      };
    },
  );

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

const MONTHS: Record<string, string> = { jan: "01", mar: "03", aug: "08" };

// 5,000 in and 1,000 out in the month, from `opening`.
function statement(month: string, opening: number, parser: string) {
  const m = MONTHS[month];
  return {
    transactions: [
      {
        date: `2026-${m}-03`,
        narration: "NOPII SALARY",
        withdrawal: 0,
        deposit: 5000,
        balance: null,
      },
      {
        date: `2026-${m}-10`,
        narration: "NOPII GROCERIES",
        withdrawal: 1000,
        deposit: 0,
        balance: null,
      },
    ],
    opening,
    closing: opening + 4000,
    account: {
      kind: "bank",
      identifier:
        parser === "sample-bank-xls" ? "050505000012" : "050505000099",
    },
    institution: "OTHER SAMPLE BANK LTD",
  };
}

function form(names: string[], fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const name of names) body.append("files", new File(["NOPII"], name));
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}

function readDrop(names: string[], fields: Record<string, string> = {}) {
  return app.request("/add-account/read", {
    method: "POST",
    body: form(names, fields),
  });
}

function addDrop(names: string[], fields: Record<string, string> = {}) {
  return app.request("/add-account/add", {
    method: "POST",
    body: form(names, { institution: "NOPII Bank", ...fields }),
  });
}

function staged(): string[] {
  const dir = join(root, "tmp", "statement-uploads");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("POST /add-account/read", () => {
  it("reads the drop and keeps nothing staged", async () => {
    const response = await readDrop(["other-aug.pdf", "savings-aug.xls"]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      files: { status: string; account_key: string; saved_path: unknown }[];
      accounts: { key: string; status: string; refusal: unknown }[];
      categorizer: unknown;
    };
    expect(
      body.files.map((file) => [file.account_key, file.saved_path]),
    ).toEqual([
      ["new:bank:050505000099", null],
      ["account:2", null],
    ]);
    expect(body.categorizer).toMatchObject({ ready: false });
    expect(
      body.accounts.map((one) => [one.key, one.status, one.refusal]),
    ).toEqual([
      ["account:2", "empty", null],
      ["new:bank:050505000099", "new", null],
    ]);
    expect(staged()).toEqual([]);
  });

  it("gives the import's refusal as /import words it", async () => {
    const response = await readDrop(["other-jan.pdf", "other-mar.pdf"]);

    const body = (await response.json()) as {
      accounts: { refusal: unknown }[];
    };
    expect(body.accounts[0].refusal).toMatchObject({
      error: "statement_boundary_mismatch",
      reason: "gap",
      earlier_source: "other-jan.pdf",
      later_source: "other-mar.pdf",
      difference: 2000,
    });
    expect(staged()).toEqual([]);
  });

  it("keeps the drop staged for a file no parser reads, and says where", async () => {
    const response = await readDrop(["NOPII-unknown.pdf", "savings-aug.xls"]);

    const body = (await response.json()) as {
      files: { status: string; saved_path?: string }[];
    };
    expect(body.files[0]).toMatchObject({ status: "unrecognized" });
    const saved = body.files[0].saved_path!;
    expect(saved).toMatch(/^tmp\/statement-uploads\/.+\/0-NOPII-unknown\.pdf$/);
    expect(existsSync(join(root, saved))).toBe(true);
  });

  it("keeps the drop staged for a refusal /import gives a prompt for", async () => {
    const response = await readDrop(["other-bad.pdf"]);

    const body = (await response.json()) as {
      files: { saved_path: string }[];
      accounts: { refusal: unknown }[];
    };
    expect(body.accounts[0].refusal).toMatchObject({
      error: "balance_mismatch",
    });
    expect(body.files[0].saved_path).toMatch(/0-other-bad\.pdf$/);
    expect(existsSync(join(root, body.files[0].saved_path))).toBe(true);
  });

  it("refuses a drop with no files", async () => {
    const response = await readDrop([]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "missing_multipart_field",
    });
  });
});

describe("POST /add-account/add", () => {
  it("adds the account, imports its statements and keeps nothing staged", async () => {
    const response = await addDrop(["other-aug.pdf"], {
      name: "Sample Current",
      parent_id: "1",
      opening_amount: "",
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { account_id: number };
    expect(body).toEqual({
      account_id: body.account_id,
      account_name: "Sample Current",
      drafts: 2,
    });
    expect(staged()).toEqual([]);

    // Its statements are in the books now.
    const again = await readDrop(["other-aug.pdf"]);
    expect(await again.json()).toMatchObject({
      accounts: [
        {
          status: "in_books",
          account: { id: body.account_id, name: "Sample Current" },
        },
      ],
    });
    const refused = await addDrop(["other-aug.pdf"], { name: "NOPII" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "already_in_books" });
  });

  it("refuses files from two accounts, and fields that don't parse", async () => {
    const two = await addDrop(["other-aug.pdf", "savings-aug.xls"], {
      name: "Sample Current",
    });
    expect(two.status).toBe(422);
    expect(await two.json()).toMatchObject({ code: "several_accounts" });

    const bad = await addDrop(["other-aug.pdf"], { parent_id: "NOPII" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_fields" });
    expect(staged()).toEqual([]);
  });

  it("carries the import's refusal, and writes nothing", async () => {
    const response = await addDrop(["other-jan.pdf", "other-mar.pdf"], {
      name: "Sample Current",
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({
      code: "import_refused",
      import_error: { error: "statement_boundary_mismatch", difference: 2000 },
    });
    // A gap is the flow's own card: nothing stays staged for it.
    expect(body).not.toHaveProperty("files");
    expect(staged()).toEqual([]);
    expect(
      conn.sqlite
        .prepare("SELECT COUNT(*) AS n FROM accounts WHERE name = ?")
        .get("Sample Current"),
    ).toEqual({ n: 0 });
  });

  it("keeps the files, and says where, for a refusal /import gives a prompt for", async () => {
    const response = await addDrop(["other-bad.pdf"], {
      name: "Sample Current",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      files: { file_name: string; saved_path: string }[];
    };
    expect(body).toMatchObject({
      code: "import_refused",
      import_error: { error: "balance_mismatch" },
      files: [{ file_name: "other-bad.pdf" }],
    });
    expect(existsSync(join(root, body.files[0].saved_path))).toBe(true);
  });

  it("keeps nothing for a file it can't read: the read has it", async () => {
    const response = await addDrop(["NOPII-unknown.pdf"], { name: "NOPII" });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "statement_unreadable",
    });
    expect(staged()).toEqual([]);
  });
});
