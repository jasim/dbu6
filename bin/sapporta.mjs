#!/usr/bin/env node

// The `sapporta` command, as a dbu6 project has it.
//
// The Sapporta CLI lives in `@sapporta/server`, which is dbu6's dependency and
// not the project's. A package manager links the bins of a package's *direct*
// dependencies into the folder that holds it, so in a project the real binary
// sits at `node_modules/@dbu6/app/node_modules/.bin/sapporta` — deeper still
// under pnpm's isolated layout — and a bare `sapporta …` finds nothing. dbu6
// declares this bin instead, from its own package, so `npx sapporta …` resolves
// the way `npx dbu6 …` does: through `@dbu6/app`, whatever installed it and
// from whichever directory the command runs.
//
// Two things happen before the CLI starts, both because a coding agent begins
// in a project folder and should not have to be told either:
//
//   * The project's `.env` and `.env.agent` are loaded, so the CLI sees
//     `SAPPORTA_API_URL` and `SAPPORTA_API_TOKEN` — a shell export still wins.
//   * `SAPPORTA_API_URL` is derived from `SAPPORTA_API_PORT` when nothing names
//     the URL, so a project whose port was moved stays reachable.
//
// The CLI runs as a child process, not in this one: its entry point reads
// `process.argv`, parses it as a program and exits the process, so delegating
// in process would take away this file's exit code and any say over what runs.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { findProjectRoot, resolveSapportaEnvironment } from "./sapporta-env.mjs";

const packageDir = path.resolve(import.meta.dirname, "..");
const root = findProjectRoot(process.cwd());
const { env } = resolveSapportaEnvironment({ root, shellEnv: process.env });

// Resolved before spawning, so a broken install is one written line rather than
// a Node loader stack: `dbu6 check` reports the first line of what this prints.
let cli;
try {
  cli = resolveCli(packageDir);
} catch (error) {
  const reason = String(error?.message ?? error).split("\n")[0];
  console.error(
    `The Sapporta CLI dbu6 forwards to is missing from its own install: ${reason}`,
  );
  console.error(
    "Reinstall dbu6 (`npm install @dbu6/app`, or `npx dbu6 upgrade`), then run this again.",
  );
  process.exit(1);
}

const { status, signal } = spawnSync(
  process.execPath,
  [cli, ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, ...env } },
);
process.exit(status ?? (signal ? 1 : 0));

/**
 * The CLI entry point inside the installed `@sapporta/server`.
 *
 * Resolved from dbu6's own package with `createRequire`, because that is the
 * copy this dbu6 was built against: another version installed beside it in the
 * project must not change which CLI runs.
 */
function resolveCli(from) {
  const require = createRequire(path.join(from, "package.json"));
  const manifest = require.resolve("@sapporta/server/package.json");
  return path.join(path.dirname(manifest), "bin", "sapporta.mjs");
}
