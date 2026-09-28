#!/usr/bin/env node

// Proves `npm init @dbu6` reaches `dbu6 init`: the packed @dbu6/create
// installs under npm with the packed @dbu6/app as its dependency, and its
// command finds the app and runs `init` with the arguments it was given.
//
//   node scripts/verify-create.mjs <pack-out-dir> <scratch-dir>
//
// <pack-out-dir> is what `node scripts/pack.mjs --out <dir>` wrote. The
// @dbu6/app version the create tarball names is not in the registry, so an npm
// `overrides` entry points it at the app tarball, beside any overrides.json
// for a linked Sapporta. The command is run with no directory, so `init`
// prints its usage and exits 1 without making a project: making one from the
// tarball is scripts/verify-init.mjs's job.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const [packDirArg, scratchDirArg] = process.argv.slice(2);
if (!packDirArg || !scratchDirArg) {
  console.error("usage: node scripts/verify-create.mjs <pack-out-dir> <scratch-dir>");
  process.exit(1);
}
const packDir = path.resolve(packDirArg);
const scratchDir = path.resolve(scratchDirArg);

const tarball = (name) => {
  const found = readdirSync(packDir).filter((file) =>
    new RegExp(`^dbu6-${name}-.*\\.tgz$`).test(file),
  );
  assert.equal(found.length, 1, `expected one @dbu6/${name} tarball in ${packDir}`);
  return path.join(packDir, found[0]);
};
const overridesFile = path.join(packDir, "overrides.json");
const overrides = {
  ...(existsSync(overridesFile)
    ? JSON.parse(readFileSync(overridesFile, "utf8"))
    : {}),
  "@dbu6/app": `file:${tarball("app")}`,
};

const PROJECT_NAME = "dbu6-create-check";
if (existsSync(scratchDir) && readdirSync(scratchDir).length > 0) {
  const manifestFile = path.join(scratchDir, "package.json");
  const earlierRun =
    existsSync(manifestFile) &&
    JSON.parse(readFileSync(manifestFile, "utf8")).name === PROJECT_NAME;
  if (!earlierRun) throw new Error(`${scratchDir} is not empty.`);
  rmSync(scratchDir, { recursive: true });
}
mkdirSync(scratchDir, { recursive: true });
writeFileSync(
  path.join(scratchDir, "package.json"),
  JSON.stringify(
    {
      name: PROJECT_NAME,
      private: true,
      dependencies: { "@dbu6/create": `file:${tarball("create")}` },
      overrides,
    },
    null,
    2,
  ) + "\n",
);

console.log("> npm install");
// The binary, not a shell's `npm`: spawnSync never goes through a shell.
const install = spawnSync("npm", ["install"], {
  cwd: scratchDir,
  stdio: "inherit",
});
assert.equal(install.status, 0, "npm install failed");

const created = JSON.parse(
  readFileSync(
    path.join(scratchDir, "node_modules/@dbu6/create/package.json"),
    "utf8",
  ),
);
const app = JSON.parse(
  readFileSync(
    path.join(scratchDir, "node_modules/@dbu6/app/package.json"),
    "utf8",
  ),
);
assert.equal(created.dependencies["@dbu6/app"], created.version);
assert.equal(app.version, created.version, "@dbu6/create and @dbu6/app differ");

console.log("\n> create-dbu6 (no directory)");
const run = spawnSync(
  path.join(scratchDir, "node_modules/.bin/create-dbu6"),
  [],
  { cwd: scratchDir, encoding: "utf8" },
);
assert.equal(run.status, 1, `create-dbu6 exited with ${run.status}`);
assert.match(run.stderr, /Usage: dbu6 init <directory>/, run.stderr);

console.log(`\nnpm init @dbu6: @dbu6/create ${created.version} runs dbu6 init.`);
