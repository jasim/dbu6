#!/usr/bin/env node

// Proves the user's path: a scratch project whose only dependency is the dbu6
// tarball, installed by npm, can use the package through its `exports` and
// nothing else.
//
//   node scripts/verify-tarball.mjs <pack-out-dir> <scratch-project-dir>
//
// <pack-out-dir> is what `node scripts/pack.mjs --out <dir>` wrote: the dbu6
// tarball, and with `--local-sapporta` an overrides.json that points each
// `@sapporta/*` at a tarball packed from the linked checkout. The scratch
// project is created; it must not exist or must be empty.
//
// It checks that:
//   - `dbu6/server` and `dbu6/frontend` import under Node,
//     `dbu6/frontend.css` resolves, and better-sqlite3's binding loads
//   - nothing else is importable (`dbu6/package.json`, a deep dist path), and
//     no src/ was shipped
//   - the project typechecks a file that imports both entries, with only dbu6
//     installed
//   - the worked report of docs/examples/report, copied into the project's
//     reports/ as a user would write it, typechecks under the template's
//     tsconfig, passes its node:test test under Node, and is built into the
//     project's app. This is the contract test for the two export lists
//     (PLAN.md R1): remove an export the example uses and it fails here.
//   - the frontend host builds the project's app (dist/app), which needs the
//     installed `dbu6/frontend` and `dbu6/frontend.css` to resolve from the
//     project the way a user's build does, and knows when that build is stale
//
// N5 extends this into CI jobs (`dbu6 init`, `dbu6 check`).
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const [packDirArg, projectDirArg] = process.argv.slice(2);
if (!packDirArg || !projectDirArg) {
  console.error(
    "usage: node scripts/verify-tarball.mjs <pack-out-dir> <scratch-project-dir>",
  );
  process.exit(1);
}
const packDir = path.resolve(packDirArg);
const projectDir = path.resolve(projectDirArg);

const tarballs = readdirSync(packDir).filter((file) =>
  /^dbu6-.*\.tgz$/.test(file),
);
if (tarballs.length !== 1) {
  throw new Error(
    `Expected one dbu6 tarball in ${packDir}, found ${tarballs.length}.`,
  );
}
const overridesFile = path.join(packDir, "overrides.json");
const overrides = existsSync(overridesFile)
  ? JSON.parse(readFileSync(overridesFile, "utf8"))
  : undefined;

const PROJECT_NAME = "dbu6-tarball-check";
if (existsSync(projectDir) && readdirSync(projectDir).length > 0) {
  const manifestFile = path.join(projectDir, "package.json");
  const earlierRun =
    existsSync(manifestFile) &&
    JSON.parse(readFileSync(manifestFile, "utf8")).name === PROJECT_NAME;
  if (!earlierRun) throw new Error(`${projectDir} is not empty.`);
  rmSync(projectDir, { recursive: true });
}
mkdirSync(projectDir, { recursive: true });

writeFileSync(
  path.join(projectDir, "package.json"),
  JSON.stringify(
    {
      name: PROJECT_NAME,
      private: true,
      type: "module",
      dependencies: { dbu6: `file:${path.join(packDir, tarballs[0])}` },
      ...(overrides ? { overrides } : {}),
    },
    null,
    2,
  ) + "\n",
);
const repoRoot = path.resolve(import.meta.dirname, "..");
// The tsconfig a project starts with, so the example is checked the way a
// user's report is: what passes here also runs under Node.
writeFileSync(
  path.join(projectDir, "tsconfig.json"),
  readFileSync(path.join(repoRoot, "template/tsconfig.json"), "utf8").replace(
    '"include": [',
    '"include": ["uses-dbu6.ts", ',
  ),
);
const REPORT_ID = "spending-by-weekday";
cpSync(
  path.join(repoRoot, "docs/examples/report"),
  path.join(projectDir, "reports", REPORT_ID),
  { recursive: true },
);
writeFileSync(
  path.join(projectDir, "uses-dbu6.ts"),
  [
    'import { openDbu6Runtime, type Dbu6Runtime } from "dbu6/server";',
    'import { startDbu6Frontend } from "dbu6/frontend";',
    "",
    "export const open: (options: { root: string }) => Promise<Dbu6Runtime> = openDbu6Runtime;",
    "export const start: () => void = startDbu6Frontend;",
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(projectDir, "check.mjs"),
  `
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const server = await import("dbu6/server");
assert.equal(typeof server.openDbu6Runtime, "function");
const frontend = await import("dbu6/frontend");
assert.equal(typeof frontend.startDbu6Frontend, "function");

const require = createRequire(import.meta.url);
// The native binding loads: npm built it, with no approval step.
new (require("better-sqlite3"))(":memory:").close();
const css = require.resolve("dbu6/frontend.css");
assert.ok(css.endsWith(path.join("dist", "frontend", "frontend.css")), css);

for (const hidden of ["dbu6/package.json", "dbu6/dist/server/paths.js", "dbu6"]) {
  await assert.rejects(import(hidden), { code: /ERR_PACKAGE_PATH_NOT_EXPORTED/ }, hidden);
}
const packageDir = path.resolve(path.dirname(css), "../..");
assert.equal(existsSync(path.join(packageDir, "src")), false, "src/ was shipped");

// The package finds itself, not the project, from inside node_modules.
const { packageDir: found } = await import(path.join(packageDir, "dist/server/paths.js"));
assert.equal(found(), packageDir);

// The project has a report, so it gets its own build, once.
const { mkdtempSync, readdirSync, readFileSync, appendFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const host = await import(path.join(packageDir, "dist/frontend-host/index.js"));
const root = process.cwd();
const bare = mkdtempSync(path.join(tmpdir(), "dbu6-bare-project-"));
assert.deepEqual(host.projectFrontend(bare), {
  needsBuild: false,
  stale: false,
  appDir: path.join(packageDir, "dist/app"),
});
assert.ok(existsSync(path.join(packageDir, "dist/app/index.html")), "no prebuilt app");

assert.deepEqual(host.projectFrontend(root), {
  needsBuild: true,
  stale: true,
  appDir: path.join(root, "dist/app"),
});
assert.equal((await host.buildProjectFrontend(root, { force: false })).built, true);
assert.ok(existsSync("dist/app/index.html"), "the host wrote no dist/app/index.html");
const built = readdirSync("dist/app/assets")
  .map((file) => readFileSync(path.join("dist/app/assets", file), "utf8"))
  .join("\\n");
assert.ok(built.includes("Which days of the week the money goes out on"), "the report's screen is not in the build");
// The report's SQL lives in api.ts, which only the server reads.
assert.ok(!built.includes("scoped_journal_entries"), "the server side of the report reached the browser bundle");
assert.equal(host.projectFrontend(root).stale, false);
assert.equal((await host.buildProjectFrontend(root, { force: false })).built, false);
appendFileSync(path.join("reports", ${JSON.stringify(REPORT_ID)}, "Screen.tsx"), "\\n// edited\\n");
assert.equal(host.projectFrontend(root).stale, true, "an edited screen did not make the build stale");
console.log("\\ndbu6 tarball: all checks passed.");
`,
);

// The binary, not a shell's `npm`: execFile never goes through a shell, where
// the owner's `npm` is a function that refuses to run.
run("npm", ["install", "--no-audit", "--no-fund"]);
// A machine whose npm config sets ignore-scripts leaves better-sqlite3 without
// its native binding. It is the one install script dbu6 needs, the same one
// pnpm-workspace.yaml approves, so it is run by name; on a default npm this
// is a no-op rebuild.
run("npm", ["rebuild", "better-sqlite3", "--ignore-scripts=false"]);
run(process.execPath, [
  path.join("node_modules", "typescript", "bin", "tsc"),
  "-p",
  ".",
]);
// The report's own test, as `node --test` runs it in a user's project: Node
// strips the types from api.ts and resolves "dbu6/server" from node_modules.
run(process.execPath, [
  "--test",
  path.join("reports", REPORT_ID, "api.test.ts"),
]);
run(process.execPath, ["check.mjs"]);

function run(command, args) {
  console.log(`\n> ${path.basename(command)} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: projectDir, stdio: "inherit" });
}
