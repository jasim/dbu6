/**
 * The `dbu6` command. `bin/dbu6.mjs` calls `main` with the arguments; each
 * command resolves the project folder and its environment the same way
 * (`project.ts`) and then calls the module that does the work.
 */
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { acquireDataLock } from "../server/data-lock.js";
import { migrateSafely, type MigrateSafelyResult } from "../server/migrate-safely.js";
import { serveDbu6 } from "../server/mount.js";
import { openDbu6 } from "../server/open.js";
import { databaseFile } from "../server/paths.js";
import { runCheck } from "./check.js";
import { runDev } from "./dev.js";
import { printDocs } from "./docs.js";
import { appDir, buildFrontend } from "./frontend.js";
import { initCommand } from "./init.js";
import { runParser, testParsers } from "./parser.js";
import { loadProjectEnv, resolveProjectRoot } from "./project.js";
import { setupProject } from "./setup.js";
import { upgradeProject, type RunCommand } from "./upgrade.js";

const USAGE = `dbu6 <command>

  dev                          set up, migrate safely, then serve with reload
  start                        migrate safely, build the web app if needed, serve
  build                        build the project's web app (its reports, frontend.tsx)
  migrate                      migrate the database safely
  upgrade [version]            move to a dbu6 version (latest), migrate, check
  check                        report everything an upgrade can break
  setup                        create .env, an auth secret and user-config/
  seed [date] [--statements <dir>]   sample data for the demo account
  parser test [name]           run a parser's tests, or all of the project's
  parser run <name> <input>    run a parser on a statement file
  docs [name]                  print a guide for coding agents; lists them with no name
  init <directory>             create a project: the template, npm install, setup, migrate, first commit

The project is the folder with package.json at or above the working
directory, or DBU6_ROOT.`;

/** Runs one command. Resolves to the exit code; `serve` never resolves. */
export async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "docs":
      return printDocs(rest[0]);
    case "init":
      return initCommand(rest, runCommand);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return command === undefined ? 1 : 0;
  }

  const root = resolveProjectRoot();
  if (command === "setup") {
    await setupProject(root);
    return 0;
  }
  loadProjectEnv(root);

  switch (command) {
    case "dev":
      await setupProject(root);
      loadProjectEnv(root);
      if (!reportMigration(await migrateSafely(root))) return 1;
      return runDev(root);
    case "start":
      if (!reportMigration(await migrateSafely(root))) return 1;
      await buildFrontend(root, { onlyIfStale: true });
      return serve(root, await appDir(root));
    // What `dev` runs under node --watch: serve, and nothing before it.
    case "serve":
      return serve(
        root,
        rest.includes("--no-frontend") ? undefined : await appDir(root),
      );
    case "build":
      if (!(await buildFrontend(root))) {
        console.log(
          "Nothing to build: the project has no reports/*/report.ts and no frontend.tsx, so it is served dbu6's prebuilt web app.",
        );
      }
      return 0;
    case "migrate":
      return reportMigration(await migrateSafely(root)) ? 0 : 1;
    case "check":
      return (await runCheck(root)) ? 0 : 1;
    case "upgrade": {
      const result = await upgradeProject({
        root,
        version: rest[0],
        run: runCommand,
      });
      if (result.status === "unchanged") {
        console.log(`Already on dbu6 ${result.version}.`);
      }
      if (result.status === "rolled-back") return 1;
      return result.status === "upgraded" && !result.checkPassed ? 1 : 0;
    }
    case "seed": {
      const { seedSampleData } = await import("../server/seed/sample-data.js");
      await seedSampleData(root, rest);
      return 0;
    }
    case "parser":
      if (rest[0] === "test") return testParsers(rest[1]);
      if (rest[0] === "run" && rest.length === 3) {
        return runParser(rest[1], rest[2]);
      }
      console.error(
        "Usage: dbu6 parser test [name]\n       dbu6 parser run <name> <input>",
      );
      return 1;
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

async function serve(root: string, app: string | undefined): Promise<number> {
  // Taken before the database is opened: a server never starts on a folder
  // that another dbu6 process, `migrateSafely` included, is working on.
  const lock = acquireDataLock(dirname(databaseFile(root)));
  let opened;
  try {
    opened = await openDbu6({ root, appDir: app });
  } catch (error) {
    lock.release();
    throw error;
  }
  serveDbu6(opened.hono, opened.runtime, lock);
  // The server's own signal handlers end the process.
  return new Promise<number>(() => {});
}

/** Says what a migration did. False when the database was left as it was. */
function reportMigration(result: MigrateSafelyResult): boolean {
  switch (result.status) {
    case "up-to-date":
      return true;
    case "migrated":
      console.log(
        `Migrated the database, verified against the original:\n${result.applied
          .map((tag) => `  ${tag}`)
          .join("\n")}`,
      );
      return true;
    case "rejected":
      console.error(
        [
          result.migration === null
            ? "The database was not migrated."
            : `The database was not migrated: ${result.migration} was rejected.`,
          result.reason,
          ...result.differences.map((difference) => `  ${difference}`),
          "The database is as it was before.",
        ].join("\n"),
      );
      return false;
  }
}

const runCommand: RunCommand = (command, args, { cwd, capture = false }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status: status ?? 1, stdout }));
  });
