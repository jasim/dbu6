#!/usr/bin/env node

// Publishes dbu6 to npm. This is the only way dbu6 is published: the tarball
// is the one scripts/pack.mjs stages (a manifest without this repository's
// scripts, dev dependencies and `private`, plus the shrinkwrap), and `npm
// publish` is given that file. Publishing this directory instead would ship
// the repository, so package.json keeps `private: true` and its
// `prepublishOnly` runs this script with --refuse-direct-publish.
//
//   pnpm release [--dry-run] [--tag <dist-tag>] [--skip-tests]
//
// A release goes through, in order:
//
//   1. the gates, which cost nothing: the version in package.json is exact
//      and not the 0.0.0 placeholder, the git tree is clean, no `v<version>`
//      tag exists, and no dependency is a `link:` to a local checkout
//   2. `pii-scan --tracked` and `pii-scan --pack`: no PII, no fixture or test
//      in the package, no link: or home path in what decides its contents
//   3. `pnpm test` (skipped with --skip-tests; CI has run it on the commit)
//   4. `pnpm build`, which typechecks first
//   5. `pack.mjs --out tmp/release`, which scans the staged tree once more
//   6. `npm publish <tarball> --access public`, then `git tag v<version>`
//
// Without --dry-run the first failure stops the release. With it nothing is
// uploaded (`npm publish --dry-run` prints what would be) and every gate and
// step is run and reported, so the whole path is exercised in one go; the
// exit code says whether a release would have gone through. While Sapporta
// is linked from a checkout a dry run packs with --local-sapporta, which is
// the only way to pack at all then; the summary says so.
//
// A prerelease version is published under the `next` tag unless --tag says
// otherwise, which is npm's rule for prereleases made explicit.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "tmp", "release");
const { values: options } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    tag: { type: "string" },
    "skip-tests": { type: "boolean", default: false },
    "refuse-direct-publish": { type: "boolean", default: false },
  },
});
const dryRun = options["dry-run"];

if (options["refuse-direct-publish"]) {
  console.error(
    "dbu6 is not published from this directory: `npm publish` here would ship the\n" +
      "repository (its scripts, dev dependencies and linked packages). Run\n" +
      "`pnpm release`, which publishes the tarball scripts/pack.mjs stages.",
  );
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const { version } = manifest;
const distTag = options.tag ?? (version.includes("-") ? "next" : undefined);

/** What would stop a release: `{ what, why }`, collected in a dry run. */
const refusals = [];
function refuse(what, why) {
  refusals.push({ what, why });
  console.error(
    `\n${dryRun ? "would stop the release" : "release stopped"}: ${what}\n  ${why}`,
  );
  if (!dryRun) finish();
}

console.log(
  `dbu6 ${version}${dryRun ? " (dry run)" : ""}${distTag ? `, npm tag ${distTag}` : ""}`,
);

// --- 1. Gates ---------------------------------------------------------------

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  refuse("version", `${version} is not an exact version.`);
}
if (version === "0.0.0") {
  refuse(
    "version",
    "0.0.0 is the placeholder; set the version in package.json first.",
  );
}
const dirty = git(["status", "--porcelain"]).trim();
if (dirty !== "") {
  refuse(
    "git tree",
    `uncommitted changes; a release is made from a commit:\n${indent(dirty)}`,
  );
}
if (git(["tag", "--list", `v${version}`]).trim() !== "") {
  refuse("git tag", `v${version} already exists.`);
}
const linked = Object.entries(manifest.dependencies ?? {})
  .filter(([, spec]) => /^(link|file):/.test(spec))
  .map(([name]) => name);
if (linked.length > 0) {
  refuse(
    "dependencies",
    `${linked.join(", ")} come from a local checkout. Publish Sapporta and run ` +
      "`pnpm package-sources:use-npm` first.",
  );
}

// --- 2–4. Scans, tests, build -----------------------------------------------

step("pii-scan --tracked", "node", ["scripts/pii-scan.mjs", "--tracked"]);
step("pii-scan --pack", "node", ["scripts/pii-scan.mjs", "--pack"]);
if (options["skip-tests"]) {
  console.log("\n> pnpm test: skipped (--skip-tests)");
} else {
  step("pnpm test", "pnpm", ["test"]);
}
if (!step("pnpm build", "pnpm", ["build"])) finish();

// --- 5. Pack ----------------------------------------------------------------

const packArgs = ["scripts/pack.mjs", "--out", outDir];
if (dryRun && linked.length > 0) {
  console.log(
    "\nSapporta is linked, so this dry run packs with --local-sapporta: a tarball\n" +
      "without a shrinkwrap, which is never published.",
  );
  packArgs.push("--local-sapporta", "--version", version);
}
if (!step("pack", "node", packArgs)) finish();
const tarball = readdirSync(outDir).find((file) => /^dbu6-.*\.tgz$/.test(file));
if (!tarball) {
  refuse("pack", `no dbu6 tarball in ${outDir}.`);
  finish();
}

// --- 6. Publish -------------------------------------------------------------

const publishArgs = ["publish", tarball, "--access", "public"];
if (distTag) publishArgs.push("--tag", distTag);
if (dryRun) publishArgs.push("--dry-run");
// The binary, not a shell's `npm`: the owner's shell defines a function of
// that name that refuses to run. spawnSync with a command never goes through
// a shell. It runs in tmp/release, where the tarball is; nothing in this
// directory is read.
if (!step(`npm publish ${tarball}`, "npm", publishArgs, outDir)) finish();

if (!dryRun) {
  const tagged = spawnSync(
    "git",
    ["tag", "-a", `v${version}`, "-m", `dbu6 ${version}`],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  console.log(
    tagged.status === 0
      ? `\nPublished dbu6 ${version} and tagged v${version}. Push the tag: git push origin v${version}`
      : `\nPublished dbu6 ${version}. Tagging failed; tag the commit yourself: git tag -a v${version}`,
  );
}
finish();

// ---------------------------------------------------------------------------

/** Runs a step, reporting a failure as a refusal. Returns whether it passed. */
function step(label, command, args, cwd = root) {
  console.log(`\n> ${label}`);
  const { status, error } = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (error) refuse(label, error.message);
  else if (status !== 0) refuse(label, `exited with ${status}; see above.`);
  return !error && status === 0;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function finish() {
  if (refusals.length === 0) {
    if (dryRun) {
      console.log(
        `\nDry run complete: a release of dbu6 ${version} would go through. Run pnpm release.`,
      );
    }
    process.exit(0);
  }
  console.error(
    `\n${dryRun ? "Dry run complete. A release would be stopped by" : "The release was stopped by"}:` +
      refusals
        .map(({ what, why }) => `\n  - ${what}: ${why.split("\n")[0]}`)
        .join(""),
  );
  if (existsSync(outDir) && dryRun) {
    console.error(`\nThe tarball, when one was packed, is in ${outDir}.`);
  }
  process.exit(1);
}
