#!/usr/bin/env node

// Proves the first thing a user does (PLAN.md N5): `dbu6 init` makes a
// project from the packed tarball, under npm, and `dbu6 start` in that
// project serves the app.
//
//   node scripts/verify-init.mjs <pack-out-dir> <scratch-project-dir>
//                                [--api-port 2400] [--frontend-port 2401]
//
// <pack-out-dir> is what `node scripts/pack.mjs --out <dir>` wrote: the dbu6
// tarball, and with `--local-sapporta` an overrides.json that points each
// `@sapporta/*` at a tarball packed from the linked checkout. The scratch
// project must not exist, be empty, or be an earlier run of this script.
//
// `init` is called as `initProject` from dist/cli, with the same command
// runner `dbu6 init` uses, rather than through the tarball's bin: an
// unpublished Sapporta can only be installed through npm `overrides` in the
// project's package.json, which have to be there before init's `npm install`
// runs, and the runner is init's one seam for that. Everything else is what
// `npx dbu6 init` does: the template rendered, `npm install`, the installed
// package's `setup` and `migrate`, the first commit. A published Sapporta
// needs no overrides, and CI runs this script without them.
//
// It checks that:
//   - the project has every template file, with no token left in any of them,
//     `.gitignore` under its real name, package.json pinned to the tarball,
//     and the installed dbu6 is the tarball's version
//   - `setup` and `migrate` ran: .env has a secret, user-config/ is filled,
//     data/sqlite.db exists
//   - the first commit holds the project and nothing that is gitignored
//   - `dbu6 check` passes in a fresh project
//   - `dbu6 start` answers /health and serves the prebuilt web app on the
//     given port, and stops on SIGTERM
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  options: {
    "api-port": { type: "string", default: "2400" },
    "frontend-port": { type: "string", default: "2401" },
  },
  allowPositionals: true,
});
const [packDirArg, projectDirArg] = positionals;
if (!packDirArg || !projectDirArg) {
  console.error(
    "usage: node scripts/verify-init.mjs <pack-out-dir> <scratch-project-dir> [--api-port N] [--frontend-port N]",
  );
  process.exit(1);
}
const packDir = path.resolve(packDirArg);
const projectDir = path.resolve(projectDirArg);
const apiPort = Number(options["api-port"]);
const frontendPort = Number(options["frontend-port"]);
const repoRoot = path.resolve(import.meta.dirname, "..");

const tarballs = readdirSync(packDir).filter((file) =>
  /^dbu6-.*\.tgz$/.test(file),
);
if (tarballs.length !== 1) {
  throw new Error(
    `Expected one dbu6 tarball in ${packDir}, found ${tarballs.length}.`,
  );
}
const tarball = path.join(packDir, tarballs[0]);
const tarballVersion = tarballs[0].slice("dbu6-".length, -".tgz".length);
const overridesFile = path.join(packDir, "overrides.json");
const overrides = existsSync(overridesFile)
  ? JSON.parse(readFileSync(overridesFile, "utf8"))
  : undefined;

removeEarlierRun();

// The repository's dist/cli is the tarball's dist/cli. A linked Sapporta
// needs its resolution hook before anything imports it, as bin/dbu6.mjs does.
const repoManifest = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
if (repoManifest.dependencies["@sapporta/server"]?.startsWith("link:")) {
  await import("@sapporta/server/source-link-runtime");
}
const initModule = path.join(repoRoot, "dist/cli/init.js");
if (!existsSync(initModule)) {
  throw new Error(`${initModule} is missing. Run pnpm build first.`);
}
const { initProject } = await import(pathToFileURL(initModule).href);

// The first commit needs an identity. A CI runner has none; this sets one for
// the commands this script runs, and configures nothing on the machine.
process.env.GIT_AUTHOR_NAME ??= "dbu6 verify-init";
process.env.GIT_AUTHOR_EMAIL ??= "verify-init@example.test";
process.env.GIT_COMMITTER_NAME ??= process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL ??= process.env.GIT_AUTHOR_EMAIL;

const commands = [];
const result = await initProject({
  target: projectDir,
  dbu6: `file:${tarball}`,
  run: async (command, args, runOptions) => {
    commands.push([path.basename(command), ...args].join(" "));
    if (overrides && command === "npm" && args[0] === "install") {
      addOverrides(runOptions.cwd);
    }
    console.log(`\n> ${path.basename(command)} ${args.join(" ")}`);
    return run(command, args, runOptions);
  },
});

console.log("\nChecking the project");
assert(result.committed, "init did not commit the project");
const templateDir = path.join(repoRoot, "template");
for (const name of readdirSync(templateDir)) {
  const written = name === "gitignore" ? ".gitignore" : name;
  assert(existsSync(path.join(projectDir, written)), `${written} is missing`);
}
assert(!existsSync(path.join(projectDir, "gitignore")), "gitignore was not renamed");
for (const file of globSync("**/*", {
  cwd: projectDir,
  exclude: (name) => name === "node_modules" || name === ".git" || name === "data",
})) {
  const full = path.join(projectDir, file);
  if (!statSync(full).isFile()) continue;
  assert(
    !readFileSync(full, "utf8").includes("%%SAPPORTA"),
    `${file} still has a template token`,
  );
}
const manifest = JSON.parse(
  readFileSync(path.join(projectDir, "package.json"), "utf8"),
);
assert.equal(manifest.name, path.basename(projectDir).toLowerCase());
assert.equal(manifest.dependencies.dbu6, `file:${tarball}`);
const installed = JSON.parse(
  readFileSync(path.join(projectDir, "node_modules/dbu6/package.json"), "utf8"),
);
assert.equal(installed.version, tarballVersion, "not the tarball's version");
assert(
  /^BETTER_AUTH_SECRET=\S+$/m.test(readFileSync(path.join(projectDir, ".env"), "utf8")),
  "setup did not fill in BETTER_AUTH_SECRET",
);
assert(
  readdirSync(path.join(projectDir, "user-config")).length > 0,
  "setup did not fill user-config/",
);
assert(existsSync(path.join(projectDir, "data/sqlite.db")), "migrate made no database");
assert(existsSync(path.join(projectDir, ".git")), "no git repository");
assert.equal(
  (await run("git", ["rev-list", "--count", "HEAD"], { cwd: projectDir, capture: true })).stdout.trim(),
  "1",
  "not exactly one commit",
);
assert.equal(
  (await run("git", ["status", "--porcelain"], { cwd: projectDir, capture: true })).stdout,
  "",
  "the commit left files behind, or committed something gitignored",
);
const tracked = (
  await run("git", ["ls-files"], { cwd: projectDir, capture: true })
).stdout.split("\n");
for (const secret of [".env", "data/sqlite.db"]) {
  assert(!tracked.includes(secret), `${secret} was committed`);
}

const dbu6 = path.join(projectDir, "node_modules/dbu6/bin/dbu6.mjs");
console.log("\n> dbu6 check");
const check = await run(process.execPath, [dbu6, "check"], { cwd: projectDir });
assert.equal(check.status, 0, "dbu6 check failed in a fresh project");

// The env wins over .env, so the ports are given without editing the file.
const env = {
  ...process.env,
  SAPPORTA_API_PORT: String(apiPort),
  SAPPORTA_PUBLIC_APP_URL: `http://localhost:${apiPort}`,
  SAPPORTA_FRONTEND_PORT: String(frontendPort),
  SAPPORTA_FRONTEND_ORIGINS: `http://localhost:${frontendPort}`,
};
console.log(`\n> dbu6 start (port ${apiPort})`);
const server = spawn(process.execPath, [dbu6, "start"], {
  cwd: projectDir,
  env,
  stdio: "inherit",
});
const exited = new Promise((resolve) => server.once("exit", resolve));
try {
  const health = await waitFor(`http://localhost:${apiPort}/health`, exited);
  assert.equal(health.status, 200, `/health answered ${health.status}`);
  const page = await fetch(`http://localhost:${apiPort}/`);
  assert.equal(page.status, 200, `/ answered ${page.status}`);
  assert(
    (await page.text()).includes("<div id=\"root\""),
    "/ did not serve the web app",
  );
  console.log("\nThe app is up: /health and / answer.");
} finally {
  server.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!stopped) {
    server.kill("SIGKILL");
    throw new Error("dbu6 start did not stop on SIGTERM within 10 seconds.");
  }
}

console.log(`\ndbu6 init: all checks passed in ${projectDir}.`);

/** Waits for the URL to answer, or for the server to have exited. */
async function waitFor(url, exited, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let serverExited = false;
  exited.then(() => (serverExited = true));
  while (Date.now() < deadline) {
    if (serverExited) throw new Error("dbu6 start exited before answering.");
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} seconds.`);
}

/**
 * A scratch directory this script made before is replaced. It is recognised
 * by its package.json depending on a tarball in the pack directory, which
 * init writes first, so a run that failed at any later step counts too.
 */
function removeEarlierRun() {
  if (!existsSync(projectDir) || readdirSync(projectDir).length === 0) return;
  const manifestFile = path.join(projectDir, "package.json");
  const earlier =
    existsSync(manifestFile) &&
    String(
      JSON.parse(readFileSync(manifestFile, "utf8")).dependencies?.dbu6,
    ).startsWith(`file:${packDir}${path.sep}`);
  if (!earlier) throw new Error(`${projectDir} is not empty.`);
  rmSync(projectDir, { recursive: true });
}

function addOverrides(cwd) {
  const file = path.join(cwd, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...manifest, overrides }, null, 2) + "\n");
  console.log("  (with npm overrides for the linked Sapporta checkout)");
}

// The runner `dbu6 init` uses (src/cli/main.ts): the binary, never a shell.
function run(command, args, { cwd, capture = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status: status ?? 1, stdout }));
  });
}
