/**
 * `dbu6 check`: one report of everything an upgrade can break (PLAN.md, N4).
 * It changes nothing in the project. Each section is a function of the
 * project root that returns lines; `runCheck` runs them all, prints the
 * report and says whether any line failed, which is the command's exit code
 * and what `dbu6 upgrade` looks at.
 *
 *   Tools       Node against the package's `engines`, better-sqlite3's
 *               native binding, uv, pdftotext
 *   Migrations  the ones the database has not applied, as information
 *   Types       `tsc --noEmit` with the project's tsconfig, when it has any
 *               TypeScript: Node strips types without checking them, so this
 *               is where an export that moved shows
 *   Reports     each report folder's `node --test` tests, and a build of the
 *               web app when the project has one, into a temporary directory
 *   Parsers     every project parser's tests under uv, with `shared` on
 *               PYTHONPATH, which is also where drift in shared/abacus shows;
 *               a project parser that shadows a bundled one is named
 *   Config      user-config/ read by the same code the app reads it with,
 *               and the import presets in the database
 *
 * The output is written for a coding agent: one line per check, and a
 * failure's tool output indented under it, so the fix can start from the
 * report alone.
 */
import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import { pendingMigrations } from "@sapporta/server";
import { guideCommand } from "../shared/index.js";
import {
  CategorizationConfigError,
  readTransactionMappings,
  TRANSACTION_MAPPINGS_FILENAME,
} from "../server/modules/categorization/index.js";
import { chosenCodingAgent } from "../server/modules/coding-agent/index.js";
import { readEveryImportPreset } from "../server/modules/import-presets/index.js";
import { parserDirectory } from "../server/modules/statement-sources/index.js";
import {
  databaseFile,
  dbu6MigrationsDir,
  packageDir,
  packageParsersDir,
  parserRoots,
  reportsDir,
  userConfigDir,
} from "../server/paths.js";
import { tryBuildingFrontend } from "./frontend.js";
import {
  projectParserTests,
  runParserTest,
  UV_INSTALL_HINT,
} from "./parser.js";
import { compareVersions } from "./upgrade.js";

export type CheckStatus = "ok" | "fail" | "info";

export interface CheckLine {
  /** What was checked, as a short subject: `Node`, `reports/sample`. */
  name: string;
  status: CheckStatus;
  /**
   * What was found. The first line is printed after the name; the rest,
   * usually a tool's output, is printed indented under it.
   */
  detail: string;
}

export interface CheckSection {
  title: string;
  lines: CheckLine[];
}

export type SectionCheck = (root: string) => Promise<CheckLine[]>;

const ok = (name: string, detail: string): CheckLine => ({
  name,
  status: "ok",
  detail,
});
const fail = (name: string, detail: string): CheckLine => ({
  name,
  status: "fail",
  detail,
});
const info = (name: string, detail: string): CheckLine => ({
  name,
  status: "info",
  detail,
});

// --- Tools ---

export async function checkTools(): Promise<CheckLine[]> {
  return [
    checkNodeVersion(),
    await checkBetterSqlite(),
    checkCommand("uv", ["--version"], UV_INSTALL_HINT),
    checkCommand(
      "pdftotext",
      ["-v"],
      "pdftotext reads PDF statements. Install poppler: `brew install poppler` or `apt install poppler-utils`.",
    ),
  ];
}

function checkNodeVersion(): CheckLine {
  const running = process.versions.node;
  const { engines } = JSON.parse(
    readFileSync(packageDir("package.json"), "utf8"),
  ) as { engines?: { node?: string } };
  const range = engines?.node;
  const minimum = range?.match(/^>=\s*(\d+\.\d+\.\d+)$/)?.[1];
  if (minimum === undefined) {
    return info("Node", `v${running}; dbu6 declares no minimum version.`);
  }
  return compareVersions(running, minimum) >= 0
    ? ok("Node", `v${running} satisfies dbu6's ${range}`)
    : fail(
        "Node",
        `v${running} is below dbu6's ${range}. Install a newer Node and run this again.`,
      );
}

async function checkBetterSqlite(): Promise<CheckLine> {
  try {
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(":memory:");
    const version = sqlite.pragma("user_version", { simple: true });
    sqlite.close();
    if (version !== 0) throw new Error(`user_version ${String(version)}`);
    return ok("better-sqlite3", "opens a database");
  } catch (error) {
    return fail(
      "better-sqlite3",
      `does not load: ${messageOf(error)}\n` +
        "Its native binding is built when npm installs; run `npm rebuild better-sqlite3 --ignore-scripts=false`.",
    );
  }
}

function checkCommand(
  command: string,
  args: string[],
  installHint: string,
): CheckLine {
  const run = spawnSync(command, args, { encoding: "utf8" });
  if (run.error) {
    const missing = (run.error as NodeJS.ErrnoException).code === "ENOENT";
    return fail(
      command,
      `${missing ? "is not installed or not on PATH" : `could not run: ${run.error.message}`}\n${installHint}`,
    );
  }
  const reported = `${run.stdout}${run.stderr}`.trim().split("\n")[0] ?? "";
  return ok(command, reported || "found");
}

// --- Migrations ---

export async function checkMigrations(root: string): Promise<CheckLine[]> {
  const file = databaseFile(root);
  const shown = relative(root, file) || file;
  if (!existsSync(file)) {
    return [
      info(
        "Database",
        `no ${shown} yet; \`dbu6 migrate\` (or \`start\`) creates it.`,
      ),
    ];
  }
  const { default: Database } = await import("better-sqlite3");
  const sqlite = new Database(file, { readonly: true });
  try {
    const pending = pendingMigrations(sqlite, dbu6MigrationsDir());
    if (pending.length === 0) {
      return [ok("Migrations", `${shown} has every migration applied`)];
    }
    return [
      info(
        "Migrations",
        `${pending.length} pending for ${shown}; \`dbu6 migrate\` applies them on a verified copy:\n` +
          pending.map((migration) => migration.tag).join("\n"),
      ),
    ];
  } finally {
    sqlite.close();
  }
}

// --- Types ---

const NOT_THE_PROJECTS = new Set([
  "node_modules",
  "dist",
  "data",
  "tmp",
  ".git",
]);

/** The project's own TypeScript files, from the root. */
function projectTypeScriptFiles(root: string): string[] {
  return globSync("**/*.{ts,tsx,mts,cts}", {
    cwd: root,
    // Called with each path from the root, directories included, so an
    // excluded directory is not walked.
    exclude: (path: string) => NOT_THE_PROJECTS.has(path.split(/[\\/]/)[0]!),
  }).sort();
}

export async function checkTypes(root: string): Promise<CheckLine[]> {
  const files = projectTypeScriptFiles(root);
  if (files.length === 0) {
    return [info("Types", "the project has no TypeScript files")];
  }
  const tsconfig = join(root, "tsconfig.json");
  if (!existsSync(tsconfig)) {
    return [
      fail(
        "Types",
        `${files.length} TypeScript file(s) but no tsconfig.json to check them with.\n` +
          `Copy ${packageDir("template", "tsconfig.json")} to the project as tsconfig.json.`,
      ),
    ];
  }
  const tsc = join(
    dirname(
      createRequire(packageDir("package.json")).resolve(
        "typescript/package.json",
      ),
    ),
    "bin",
    "tsc",
  );
  // A relative -p from the root: tsc then prints every path from the root.
  const run = spawnSync(
    process.execPath,
    [tsc, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const output = `${run.stdout}${run.stderr}`.trim();
  if (run.status === 0) {
    return [ok("Types", `tsc --noEmit passes over ${files.length} file(s)`)];
  }
  return [
    fail(
      "Types",
      `tsc --noEmit reports errors (tsconfig.json):\n${output || `tsc exited with ${String(run.status)}`}`,
    ),
  ];
}

// --- Reports ---

export async function checkReports(root: string): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  const dir = reportsDir(root);
  const folders = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort()
    : [];
  if (folders.length === 0) {
    lines.push(info("Reports", "the project has no reports/"));
  }
  for (const folder of folders) {
    const name = `reports/${folder}`;
    const tests = globSync("**/*.test.{ts,mts,js,mjs}", {
      cwd: join(dir, folder),
    })
      .sort()
      .map((test) => join(name, test));
    if (tests.length === 0) {
      lines.push(info(name, "no tests (*.test.ts)"));
      continue;
    }
    const run = spawnSync(process.execPath, ["--test", ...tests], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = `${run.stdout}${run.stderr}`.trim();
    lines.push(
      run.status === 0
        ? ok(name, `${tests.length} test file(s) pass`)
        : fail(name, `node --test ${tests.join(" ")} failed:\n${output}`),
    );
  }
  lines.push(await checkFrontendBuild(root));
  return lines;
}

async function checkFrontendBuild(root: string): Promise<CheckLine> {
  let entries: string[] | null;
  try {
    entries = await tryBuildingFrontend(root);
  } catch (error) {
    return fail("Web app", `the build failed:\n${buildErrorOf(error)}`);
  }
  if (entries === null) {
    return info(
      "Web app",
      "nothing to build: no reports/*/report.ts and no frontend.tsx, so dbu6's prebuilt app is served",
    );
  }
  return ok("Web app", `builds from ${entries.join(", ")}`);
}

/** Vite's and Rollup's errors carry the file and a code frame beside the message. */
function buildErrorOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { id, frame, loc } = error as Error & {
    id?: string;
    frame?: string;
    loc?: { file?: string; line?: number; column?: number };
  };
  const where =
    loc?.file !== undefined
      ? `${loc.file}:${loc.line ?? 0}:${loc.column ?? 0}`
      : id;
  // Vite folds a stack into some messages; the frames say nothing about the
  // project's code.
  const message = error.message
    .split("\n")
    .filter((line) => !/^\s+at /.test(line))
    .join("\n")
    .trim();
  return [where, message, frame].filter(Boolean).join("\n");
}

// --- Parsers ---

export async function checkParsers(): Promise<CheckLine[]> {
  const roots = parserRoots();
  const projectParsers = roots[0]!;
  if (!existsSync(projectParsers)) {
    return [
      info(
        "Parsers",
        "the project has no custom-built-parsers/; dbu6's bundled parsers are used",
      ),
    ];
  }
  const lines: CheckLine[] = [];
  const parsers = readdirSync(projectParsers, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(projectParsers, entry.name, "parser.py")),
    )
    .map((entry) => entry.name)
    .sort();
  // Only when the project's parsers are not the package's own.
  if (roots.length > 1) {
    for (const name of parsers) {
      if (existsSync(join(packageParsersDir(), name, "parser.py"))) {
        lines.push(
          info(
            `custom-built-parsers/${name}`,
            "shadows the parser of the same name bundled with dbu6",
          ),
        );
      }
    }
  }

  const tests = projectParserTests();
  const byDirectory = new Map<string, string[]>();
  for (const test of tests) {
    const directory = basename(dirname(test));
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), test]);
  }
  for (const name of parsers) {
    if (!byDirectory.has(name)) {
      lines.push(info(`custom-built-parsers/${name}`, "no tests (*_test.py)"));
    }
  }
  for (const [directory, files] of byDirectory) {
    const name = `custom-built-parsers/${directory}`;
    const failed: string[] = [];
    for (const test of files) {
      const run = runParserTest(test, "pipe");
      if (run.error) {
        return [
          ...lines,
          fail(
            name,
            `could not run uv for ${relative(projectParsers, test)}: ${run.error.message}\n${UV_INSTALL_HINT}`,
          ),
        ];
      }
      if (run.status !== 0) {
        failed.push(
          `${relative(projectParsers, test)} exited with ${String(run.status)}:\n${run.output.trim()}`,
        );
      }
    }
    lines.push(
      failed.length === 0
        ? ok(name, `${files.length} test file(s) pass`)
        : fail(name, failed.join("\n")),
    );
  }
  return lines;
}

// --- Config ---

export async function checkConfig(root: string): Promise<CheckLine[]> {
  const dir = userConfigDir();
  if (!existsSync(dir)) {
    return [
      info(
        "Config",
        "the project has no user-config/; `dbu6 setup` creates it from the examples",
      ),
      ...(await checkImportPresets(root, dir)),
    ];
  }
  return [
    await checkTransactionMappings(dir),
    ...(await checkImportPresets(root, dir)),
    await checkSettings(dir),
  ];
}

async function checkTransactionMappings(dir: string): Promise<CheckLine> {
  const name = `user-config/${TRANSACTION_MAPPINGS_FILENAME}`;
  try {
    const rules = await readTransactionMappings(dir);
    return ok(
      name,
      `${Object.keys(rules.exact).length} exact and ${rules.includes.length} includes rule(s)`,
    );
  } catch (error) {
    if (error instanceof CategorizationConfigError) {
      return fail(name, error.message);
    }
    throw error;
  }
}

async function checkImportPresets(
  root: string,
  dir: string,
): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  if (existsSync(join(dir, "import-presets.json"))) {
    lines.push(
      fail(
        "user-config/import-presets.json",
        "import presets now live in the database, and this file is no longer read. Convert it with " +
          `\`sapporta api post /api/import-presets/import-json --body '{"apply":false}'\`, then ` +
          `\`--body '{"apply":true}'\`, with the app running (\`${guideCommand("books")}\` shows how).`,
      ),
    );
  }

  const name = "Import presets";
  const file = databaseFile(root);
  if (!existsSync(file)) return lines;
  const { default: Database } = await import("better-sqlite3");
  const sqlite = new Database(file, { readonly: true });
  try {
    let institutions;
    try {
      institutions = readEveryImportPreset(sqlite);
    } catch (error) {
      return [...lines, fail(name, messageOf(error))];
    }
    if (institutions === null) {
      return [
        ...lines,
        info(
          name,
          "the database has no import_presets table until it migrates",
        ),
      ];
    }
    const ledgerIds = new Set(
      sqlite.prepare("SELECT id FROM accounts").pluck().all() as number[],
    );

    const problems: string[] = [];
    for (const institution of institutions) {
      for (const parser of institution.parsers) {
        if ((await parserDirectory(parser)) === null) {
          problems.push(
            `"${institution.name}" lists parser ${parser}, which is in none of:\n` +
              parserRoots()
                .map((root) => `  ${root}`)
                .join("\n"),
          );
        }
      }
      for (const account of institution.accounts) {
        if (!ledgerIds.has(account.account_id)) {
          problems.push(
            `"${account.name}" of "${institution.name}" imports into ledger account ${account.account_id}, which was deleted`,
          );
        }
        for (const mappings of account.custom_mappings_filenames) {
          if (!existsSync(join(dir, mappings))) {
            problems.push(
              `"${account.name}" of "${institution.name}" lists user-config/${mappings}, which does not exist`,
            );
          }
        }
      }
    }
    const accounts = institutions.flatMap((one) => one.accounts).length;
    lines.push(
      problems.length > 0
        ? fail(name, problems.join("\n"))
        : institutions.length === 0
          ? info(name, "none; the automatic import has no presets")
          : ok(
              name,
              `${institutions.length} institution(s), ${accounts} account(s)`,
            ),
    );
    return lines;
  } finally {
    sqlite.close();
  }
}

async function checkSettings(dir: string): Promise<CheckLine> {
  const name = "user-config/settings.json";
  if (!existsSync(join(dir, "settings.json"))) {
    return info(name, "absent; the first installed coding agent is used");
  }
  try {
    const agent = await chosenCodingAgent();
    return ok(
      name,
      agent === null ? "no coding agent chosen" : `coding agent ${agent}`,
    );
  } catch (error) {
    return fail(name, `does not parse: ${messageOf(error)}`);
  }
}

// --- The report ---

export const SECTIONS: { title: string; check: SectionCheck }[] = [
  { title: "Tools", check: checkTools },
  { title: "Migrations", check: checkMigrations },
  { title: "Types", check: checkTypes },
  { title: "Reports", check: checkReports },
  { title: "Parsers", check: checkParsers },
  { title: "Config", check: checkConfig },
];

/** Runs every section against `root`. Nothing is printed. */
export async function collectChecks(
  root: string,
  sections = SECTIONS,
): Promise<CheckSection[]> {
  const report: CheckSection[] = [];
  for (const { title, check } of sections) {
    report.push({ title, lines: await check(root) });
  }
  return report;
}

/** The report as text: sections, one line per check, failures' output indented. */
export function formatChecks(root: string, report: CheckSection[]): string {
  const out = [`dbu6 check: ${root}`];
  for (const { title, lines } of report) {
    out.push("", title);
    for (const line of lines) {
      const [first, ...rest] = line.detail.split("\n");
      out.push(`  ${STATUS_LABEL[line.status]}  ${line.name}: ${first}`);
      out.push(...rest.map((text) => `        ${text}`));
    }
  }
  const all = report.flatMap((section) => section.lines);
  const failed = all.filter((line) => line.status === "fail").length;
  out.push(
    "",
    failed === 0
      ? `All ${all.length} checks passed.`
      : `${failed} of ${all.length} checks failed.`,
  );
  return out.join("\n");
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "ok  ",
  fail: "FAIL",
  info: "info",
};

/**
 * `dbu6 check`. Prints the report and resolves to whether every line passed;
 * `info` lines do not count against it. `root` must be the project root that
 * `paths.ts` resolves (the command sets `DBU6_ROOT` before calling this).
 */
export async function runCheck(
  root: string,
  { log = console.log }: { log?: (text: string) => void } = {},
): Promise<boolean> {
  const report = await collectChecks(root);
  log(formatChecks(root, report));
  return report.every((section) =>
    section.lines.every((line) => line.status !== "fail"),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
