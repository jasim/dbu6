import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_LEDGER_MIGRATION,
  migrateUpTo,
  tempDir,
} from "../server/migrations.test.support.js";
import { packageDir } from "../server/paths.js";
import {
  checkConfig,
  checkMigrations,
  checkParsers,
  checkReports,
  checkTypes,
  runCheck,
  type CheckLine,
} from "./check.js";

let root: string;

const write = (file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};

beforeEach(() => {
  root = tempDir("check");
  vi.stubEnv("DBU6_ROOT", root);
  vi.stubEnv("SAPPORTA_DATA_DIR", "");
  write("package.json", '{ "name": "sample-books", "type": "module" }\n');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** A report whose test passes under Node but whose api.ts has a type error. */
function writeReport(id: string, { typeError = true } = {}): void {
  cpSync(packageDir("template", "tsconfig.json"), join(root, "tsconfig.json"));
  // The template's tsconfig sees node:test through @types/node, which a
  // user's project gets from dbu6's dependencies; here, from this checkout.
  mkdirSync(join(root, "node_modules", "@types"), { recursive: true });
  symlinkSync(
    packageDir("node_modules", "@types", "node"),
    join(root, "node_modules", "@types", "node"),
  );
  write(
    `reports/${id}/api.ts`,
    typeError
      ? 'export const total: number = "sample";\n'
      : "export const total: number = 1000;\n",
  );
  write(
    `reports/${id}/api.test.ts`,
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import { total } from "./api.ts";',
      "",
      'test("sample total", () => {',
      "  assert.ok(total !== undefined);",
      "});",
      "",
    ].join("\n"),
  );
}

function writeParser(name: string, testBody: string): void {
  write(`custom-built-parsers/${name}/parser.py`, "print('sample parser')\n");
  write(`custom-built-parsers/${name}/parser_test.py`, testBody);
}

/** Books one migration behind the oldest ledger schema's successor. */
function writeDatabaseBehind(): void {
  mkdirSync(join(root, "data"), { recursive: true });
  const sqlite = new Database(join(root, "data", "sqlite.db"));
  migrateUpTo(sqlite, FIRST_LEDGER_MIGRATION);
  sqlite.close();
}

const uvInstalled = spawnSync("uv", ["--version"]).status === 0;

const byName = (lines: CheckLine[], name: string) =>
  lines.find((line) => line.name === name);

describe("runCheck", () => {
  it.skipIf(!uvInstalled)(
    "names a report that no longer typechecks, a failing parser test and a pending migration in one run",
    async () => {
      writeReport("sample");
      writeParser(
        "hdfc-bank-xls",
        'import sys\nprint("sample assertion failed")\nsys.exit(1)\n',
      );
      writeDatabaseBehind();
      cpSync(packageDir("user-config.example"), join(root, "user-config"), {
        recursive: true,
      });
      const logged: string[] = [];

      const passed = await runCheck(root, { log: (text) => logged.push(text) });

      expect(passed).toBe(false);
      const report = logged.join("\n");
      // The report that no longer typechecks, with tsc's line.
      expect(report).toMatch(
        /FAIL {2}Types:.*\n\s+reports\/sample\/api\.ts\(1,14\): error TS2322/,
      );
      // Its test still runs: Node strips the types without checking them.
      expect(report).toContain("ok    reports/sample: 1 test file(s) pass");
      // The failing parser test, with its output, and that it shadows ours.
      expect(report).toMatch(
        /FAIL {2}custom-built-parsers\/hdfc-bank-xls: hdfc-bank-xls\/parser_test\.py exited with 1:\n\s+sample assertion failed/,
      );
      expect(report).toContain(
        "info  custom-built-parsers/hdfc-bank-xls: shadows the parser of the same name bundled with dbu6",
      );
      // The pending migration, as information.
      expect(report).toMatch(
        /info {2}Migrations: \d+ pending for data\/sqlite\.db/,
      );
      expect(report).toContain("        0002_statement_import_identity");
      // The example config parses.
      expect(report).toMatch(
        /ok {4}user-config\/transaction_mappings\.mjs: \d+ exact/,
      );
      // A database that predates the presets table says so, and fails nothing.
      expect(report).toContain(
        "info  Import presets: the database has no import_presets table until it migrates",
      );
      expect(report).toMatch(/\n\d+ of \d+ checks failed\.$/);
    },
    60_000,
  );
});

describe("checkTypes", () => {
  it("passes over a report that typechecks", async () => {
    writeReport("sample", { typeError: false });
    const [line] = await checkTypes(root);
    expect(line).toMatchObject({ status: "ok", name: "Types" });
    expect(line!.detail).toContain("2 file(s)");
  }, 30_000);

  it("is information when the project has no TypeScript", async () => {
    expect(await checkTypes(root)).toEqual([
      {
        name: "Types",
        status: "info",
        detail: "the project has no TypeScript files",
      },
    ]);
  });

  it("fails when TypeScript files have no tsconfig to check them with", async () => {
    write("dbu6.config.ts", "export default {};\n");
    const [line] = await checkTypes(root);
    expect(line).toMatchObject({ status: "fail" });
    expect(line!.detail).toContain("tsconfig.json");
  });
});

describe("checkReports", () => {
  it("runs each report's tests and reports a failing one with its output", async () => {
    writeReport("passing", { typeError: false });
    write(
      "reports/failing/api.test.ts",
      [
        'import { test } from "node:test";',
        'test("sample failure", () => { throw new Error("sample went wrong"); });',
        "",
      ].join("\n"),
    );
    write("reports/untested/api.ts", "export const x = 1;\n");

    const lines = await checkReports(root);

    expect(byName(lines, "reports/passing")).toMatchObject({ status: "ok" });
    const failing = byName(lines, "reports/failing")!;
    expect(failing.status).toBe("fail");
    expect(failing.detail).toContain("sample went wrong");
    expect(byName(lines, "reports/untested")).toMatchObject({
      status: "info",
      detail: "no tests (*.test.ts)",
    });
    // No report.ts and no frontend.tsx: nothing to build.
    expect(byName(lines, "Web app")).toMatchObject({ status: "info" });
  }, 30_000);
});

describe("checkMigrations", () => {
  it("is information when there is no database yet", async () => {
    expect(await checkMigrations(root)).toEqual([
      {
        name: "Database",
        status: "info",
        detail:
          "no data/sqlite.db yet; `dbu6 migrate` (or `start`) creates it.",
      },
    ]);
  });

  it("lists the pending migrations without applying them", async () => {
    writeDatabaseBehind();
    const [line] = await checkMigrations(root);
    expect(line).toMatchObject({ status: "info", name: "Migrations" });
    expect(line!.detail).toContain("0002_statement_import_identity");
    // Still behind: check changed nothing.
    expect((await checkMigrations(root))[0]!.detail).toBe(line!.detail);
  });
});

describe("checkParsers", () => {
  it("is information when the project has no parsers of its own", async () => {
    expect(await checkParsers()).toEqual([
      {
        name: "Parsers",
        status: "info",
        detail:
          "the project has no custom-built-parsers/; dbu6's bundled parsers are used",
      },
    ]);
  });

  it.skipIf(!uvInstalled)(
    "passes a parser whose tests pass and notes one without tests",
    async () => {
      writeParser("sample-bank-csv", 'print("sample ok")\n');
      write("custom-built-parsers/sample-untested/parser.py", "");

      const lines = await checkParsers();

      expect(
        byName(lines, "custom-built-parsers/sample-bank-csv"),
      ).toMatchObject({
        status: "ok",
        detail: "1 test file(s) pass",
      });
      expect(
        byName(lines, "custom-built-parsers/sample-untested"),
      ).toMatchObject({
        status: "info",
      });
      expect(lines.some((line) => line.detail.includes("shadows"))).toBe(false);
    },
    60_000,
  );
});

describe("checkConfig", () => {
  /** A migrated database in the project, holding `sql`'s rows. */
  function writeBooks(sql: string): void {
    mkdirSync(join(root, "data"), { recursive: true });
    const sqlite = new Database(join(root, "data", "sqlite.db"));
    migrate(drizzle(sqlite), { migrationsFolder: packageDir("migrations") });
    sqlite.exec(sql);
    sqlite.close();
  }

  it("is information when there is no user-config/", async () => {
    expect((await checkConfig(root))[0]).toMatchObject({ status: "info" });
  });

  it("fails on a mappings file that does not export mappings, a leftover presets file, presets naming what is missing, and settings that do not parse", async () => {
    write("user-config/transaction_mappings.mjs", "export const rules = {};\n");
    write("user-config/import-presets.json", "[]\n");
    write("user-config/settings.json", '{ "coding_agent": "sample-agent" }\n');
    writeBooks(`
      INSERT INTO import_presets
        (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
      VALUES ('workspace', 'user', 'Sample Bank', '["no-such-parser"]', '${JSON.stringify(
        [
          {
            account_id: 9,
            name: "Sample Savings",
            is_credit_card: false,
            account_identifiers: [],
            custom_mappings_filenames: ["custom_mappings_sample.prompt"],
          },
        ],
      )}', '');
    `);

    const lines = await checkConfig(root);

    expect(lines.map((line) => [line.name, line.status])).toEqual([
      ["user-config/transaction_mappings.mjs", "fail"],
      ["user-config/import-presets.json", "fail"],
      ["Import presets", "fail"],
      ["user-config/settings.json", "fail"],
    ]);
    expect(lines[0]!.detail).toContain('must export a "mappings" object');
    expect(lines[1]!.detail).toContain("/api/import-presets/import-json");
    expect(lines[2]!.detail).toContain("no-such-parser");
    expect(lines[2]!.detail).toContain("custom_mappings_sample.prompt");
    expect(lines[2]!.detail).toContain(
      '"Sample Savings" of "Sample Bank" imports into ledger account 9, which was deleted',
    );
    expect(lines[3]!.detail).toContain("does not parse");
  });

  it("passes the example config and presets that name what exists", async () => {
    cpSync(packageDir("user-config.example"), join(root, "user-config"), {
      recursive: true,
    });
    writeBooks(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, account_type, created_at, updated_at)
      VALUES (1, 'workspace', 'user', 'Sample Savings', 'Asset', '', '');
      INSERT INTO import_presets
        (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
      VALUES ('workspace', 'user', 'Sample Bank', '["hdfc-bank-xls"]', '${JSON.stringify(
        [
          {
            account_id: 1,
            name: "Sample Savings",
            is_credit_card: false,
            account_identifiers: [],
            custom_mappings_filenames: ["custom_mappings_default.prompt"],
          },
        ],
      )}', '');
    `);
    const lines = await checkConfig(root);
    expect(lines.map((line) => [line.name, line.status])).toEqual([
      ["user-config/transaction_mappings.mjs", "ok"],
      ["Import presets", "ok"],
      ["user-config/settings.json", "info"],
    ]);
  });
});
