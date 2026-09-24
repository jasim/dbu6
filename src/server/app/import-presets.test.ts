import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SapportaEnv } from "@sapporta/server";
import type { ImportPresetChange } from "../../shared/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import importPresetsApi from "./import-presets.js";

// A project with no parsers of its own, so the saved parsers are dbu6's.
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-import-presets-"));
  vi.stubEnv("DBU6_ROOT", root);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const BANK_PARSER = "hdfc-bank-xls";
const CARD_PARSER = "hdfc-cc-xls";

/* Sample Savings (1) and Sample Card (2), and no presets. */
function books() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Sample Savings', NULL, 'Asset', '', ''),
      (2, 'workspace', 'user', 'Sample Card', NULL, 'Liability', '', '');
  `);
  const app = new Hono<SapportaEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", testLedgerAuth());
    c.set("db", db as never);
    c.set("sqlite", sqlite);
    await next();
  });
  app.route("/", importPresetsApi);

  const call = async (path: string, init?: RequestInit) => {
    const response = await app.request(path, init);
    return { status: response.status, body: await response.json() };
  };
  return {
    sqlite,
    list: () => call("/import-presets"),
    convert: (apply: boolean) =>
      call("/import-presets/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      }),
    change: (changes: ImportPresetChange[]) =>
      call("/import-presets/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      }),
    rows: () =>
      sqlite
        .prepare(
          "SELECT id, name, parsers, accounts FROM import_presets ORDER BY id",
        )
        .all(),
  };
}

const savings = {
  account_id: 1,
  name: "Sample Savings",
  is_credit_card: false,
  account_identifiers: [],
  custom_mappings_filenames: [
    "custom_mappings_default.prompt",
    "custom_mappings_personal.prompt",
  ],
};

const bankWithSavings: ImportPresetChange[] = [
  { kind: "add_institution", name: "Sample Bank", parsers: [BANK_PARSER] },
  { kind: "add_account", institution: "Sample Bank", ...savings },
];

describe("the import presets routes", () => {
  it("writes a batch and returns the presets with ledger names", async () => {
    const presets = books();
    const written = await presets.change(bankWithSavings);
    expect(written).toEqual({
      status: 200,
      body: {
        institutions: [
          {
            id: expect.any(Number),
            name: "Sample Bank",
            parsers: [BANK_PARSER],
            accounts: [{ ...savings, ledger_account_name: "Sample Savings" }],
          },
        ],
      },
    });
    expect(await presets.list()).toEqual(written);
  });

  it("writes nothing of a refused batch", async () => {
    const presets = books();
    const refused = await presets.change([
      ...bankWithSavings,
      { kind: "add_institution", name: "Sample Bank", parsers: [] },
    ]);
    expect(refused).toEqual({
      status: 422,
      body: {
        error: 'Two institutions are named "Sample Bank".',
        code: "institution_name_taken",
        change_index: null,
      },
    });
    expect(presets.rows()).toEqual([]);

    expect(
      await presets.change([
        ...bankWithSavings,
        { kind: "remove_institution", institution: "Sample Bank" },
      ]),
    ).toMatchObject({
      status: 422,
      body: { code: "institution_has_accounts", change_index: 2 },
    });
    expect(presets.rows()).toEqual([]);
  });

  it("refuses an account id the ledger doesn't have (rule 7)", async () => {
    const presets = books();
    expect(
      await presets.change([
        { kind: "add_institution", name: "Sample Bank", parsers: [] },
        {
          kind: "add_account",
          institution: "Sample Bank",
          ...savings,
          account_id: 99,
        },
      ]),
    ).toEqual({
      status: 422,
      body: {
        error: "The ledger has no account with id 99.",
        code: "unknown_ledger_account",
        change_index: 1,
      },
    });
    expect(presets.rows()).toEqual([]);
  });

  it("refuses a parser that isn't saved (rule 8)", async () => {
    const presets = books();
    expect(
      await presets.change([
        { kind: "add_institution", name: "Sample Bank", parsers: [] },
        {
          kind: "add_parser",
          institution: "Sample Bank",
          parser: "sample-missing-xls",
        },
      ]),
    ).toMatchObject({
      status: 422,
      body: { code: "unknown_parser", change_index: 1 },
    });
  });

  it("lets a dangling id already listed stand while other writes go on", async () => {
    const presets = books();
    await presets.change(bankWithSavings);
    presets.sqlite.exec("DELETE FROM accounts WHERE id = 1");

    const listed = await presets.list();
    expect(listed.body.institutions[0].accounts[0]).toMatchObject({
      account_id: 1,
      ledger_account_name: null,
    });

    const written = await presets.change([
      { kind: "add_institution", name: "Sample Cards", parsers: [CARD_PARSER] },
      {
        kind: "add_account",
        institution: "Sample Cards",
        account_id: 2,
        name: "Sample Card",
        is_credit_card: true,
        account_identifiers: ["050505XXXXXX0505"],
        custom_mappings_filenames: ["custom_mappings_default.prompt"],
      },
      {
        kind: "update_account",
        account_id: 1,
        custom_mappings_filenames: ["custom_mappings_default.prompt"],
      },
    ]);
    expect(written.status).toBe(200);
    expect(
      written.body.institutions.map(
        (one: { name: string; accounts: { name: string }[] }) => [
          one.name,
          one.accounts.map((account) => account.name),
        ],
      ),
    ).toEqual([
      ["Sample Bank", ["Sample Savings"]],
      ["Sample Cards", ["Sample Card"]],
    ]);
  });

  it("renames, reorders and removes in place", async () => {
    const presets = books();
    await presets.change(bankWithSavings);
    const [{ id }] = presets.rows() as { id: number }[];

    await presets.change([
      {
        kind: "rename_institution",
        institution: "Sample Bank",
        new_name: "Sample Bank One",
      },
      {
        kind: "update_account",
        account_id: 1,
        custom_mappings_filenames: [
          "custom_mappings_personal.prompt",
          "custom_mappings_default.prompt",
        ],
      },
    ]);
    expect(presets.rows()).toEqual([
      {
        id,
        name: "Sample Bank One",
        parsers: JSON.stringify([BANK_PARSER]),
        accounts: JSON.stringify([
          {
            ...savings,
            custom_mappings_filenames: [
              "custom_mappings_personal.prompt",
              "custom_mappings_default.prompt",
            ],
          },
        ]),
      },
    ]);

    await presets.change([
      { kind: "remove_account", account_id: 1 },
      { kind: "remove_institution", institution: "Sample Bank One" },
    ]);
    expect(presets.rows()).toEqual([]);
  });

  it("refuses a malformed change before anything runs", async () => {
    const presets = books();
    const refused = await presets.change([
      {
        kind: "add_parser",
        institution: "Sample Bank",
        parser: "custom-built-parsers/hdfc-bank-xls",
      },
    ]);
    expect(refused.status).toBe(400);
  });
});

describe("converting user-config/import-presets.json", () => {
  const file = () => join(root, "user-config", "import-presets.json");
  function writePresetsFile(presets: unknown[]) {
    mkdirSync(join(root, "user-config"), { recursive: true });
    writeFileSync(file(), JSON.stringify(presets));
  }
  const presetsFile = [
    {
      name: "Sample Bank XLS",
      base_account: "Sample Savings",
      custom_statement_parser_path: BANK_PARSER,
      custom_mappings_filenames: ["custom_mappings_default.prompt"],
    },
    {
      name: "Sample Card XLS",
      base_account: "Sample Card",
      is_credit_card: true,
      custom_statement_parser_path: CARD_PARSER,
      statement_account_identifier: "050505XXXXXX0505",
      custom_mappings_filenames: ["custom_mappings_default.prompt"],
    },
  ];
  const converted = [
    {
      id: null,
      name: "Sample Bank XLS",
      parsers: [BANK_PARSER],
      accounts: [
        {
          account_id: 1,
          name: "Sample Bank XLS",
          is_credit_card: false,
          account_identifiers: [],
          custom_mappings_filenames: ["custom_mappings_default.prompt"],
          ledger_account_name: "Sample Savings",
        },
      ],
    },
    {
      id: null,
      name: "Sample Card XLS",
      parsers: [CARD_PARSER],
      accounts: [
        {
          account_id: 2,
          name: "Sample Card XLS",
          is_credit_card: true,
          account_identifiers: ["050505XXXXXX0505"],
          custom_mappings_filenames: ["custom_mappings_default.prompt"],
          ledger_account_name: "Sample Card",
        },
      ],
    },
  ];

  it("answers 404 when there is no file", async () => {
    rmSync(file(), { force: true });
    expect(await books().convert(false)).toEqual({
      status: 404,
      body: {
        error: "user-config/import-presets.json does not exist.",
        code: "no_presets_file",
      },
    });
  });

  it("proposes without writing, then writes and deletes the file", async () => {
    writePresetsFile(presetsFile);
    const presets = books();

    expect(await presets.convert(false)).toEqual({
      status: 200,
      body: { applied: false, institutions: converted, warnings: [] },
    });
    expect(presets.rows()).toEqual([]);
    expect(existsSync(file())).toBe(true);

    const applied = await presets.convert(true);
    expect(applied).toEqual({
      status: 200,
      body: {
        applied: true,
        institutions: converted.map((one) => ({
          ...one,
          id: expect.any(Number),
        })),
        warnings: [],
      },
    });
    expect(existsSync(file())).toBe(false);
    expect((await presets.list()).body.institutions).toEqual(
      applied.body.institutions,
    );
  });

  it("keeps the file when the conversion is refused", async () => {
    writePresetsFile([
      ...presetsFile,
      {
        name: "Sample Other",
        base_account: "Sample Missing",
        custom_mappings_filenames: [],
      },
    ]);
    expect(await books().convert(true)).toMatchObject({
      status: 422,
      body: { code: "unresolved_base_accounts", names: ["Sample Missing"] },
    });
    expect(existsSync(file())).toBe(true);

    writePresetsFile([
      { ...presetsFile[0], custom_statement_parser_path: "sample-missing-xls" },
    ]);
    const presets = books();
    expect(await presets.convert(true)).toMatchObject({
      status: 422,
      body: { code: "unknown_parser" },
    });
    expect(presets.rows()).toEqual([]);
    expect(existsSync(file())).toBe(true);
  });

  it("refuses to convert over presets the table already holds", async () => {
    writePresetsFile(presetsFile);
    const presets = books();
    await presets.change(bankWithSavings);
    expect(await presets.convert(true)).toMatchObject({
      status: 422,
      body: { code: "presets_already_in_table" },
    });
    expect(existsSync(file())).toBe(true);
    expect(presets.rows()).toHaveLength(1);
  });
});
