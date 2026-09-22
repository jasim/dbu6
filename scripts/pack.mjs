#!/usr/bin/env node

// Packs dbu6 the way it is published: from a staging copy of exactly the files
// `npm pack` would include, with a manifest a user's npm can install.
//
//   node scripts/pack.mjs [--out <dir>] [--version <version>] [--local-sapporta]
//
// Run `pnpm build` first; this script packs dist/ as it finds it.
//
// What the staging manifest changes, and why it is not done in package.json:
//
// - `devDependencies`, `scripts`, `packageManager` and `private` are dropped.
//   They describe this repository, and a lifecycle script must not run in a
//   user's install.
// - `npm-shrinkwrap.json` is generated beside it (`npm install
//   --package-lock-only`, then `npm shrinkwrap`), so a user installs the
//   dependency tree that was resolved here. This repository uses pnpm, so the
//   shrinkwrap cannot be derived from pnpm-lock.yaml; it is resolved by npm at
//   pack time, from the registry.
// - The staged tree is scanned before it is packed (scripts/pii-scan.mjs:
//   the PII rules, no fixture or test, and no `link:`, `file:` or home
//   directory path in the generated manifest and shrinkwrap). This is the
//   scan of what is actually in the tarball; `pii-scan --pack` scans the
//   repository's view of it.
//
// A Sapporta package linked from a local checkout (`link:/...`, written by
// `pnpm package-sources:use-local`) is refused: the checkout has changes the
// registry lacks, so a tarball naming the registry's versions would install
// something dbu6 was not built against. Publish Sapporta and switch the
// sources back to npm (`pnpm package-sources:use-npm`) first.
//
// `--local-sapporta` is the one exception, for verifying a tarball while
// Sapporta is unpublished: each linked package becomes the version its
// checkout states, the linked packages are packed too (`pnpm pack` in each,
// which writes nothing into that checkout and rewrites its `workspace:*`
// dependencies), and the out directory gets an `overrides.json` that points
// each `@sapporta/*` at its tarball. A scratch project installs with those
// overrides (scripts/verify-tarball.mjs). No shrinkwrap is written in this
// mode: it would name files on this machine. Such a tarball is never
// published, and scripts/release.mjs packs with the flag only in a dry run.
//
// npm serves a tarball from its cache by lockfile integrity, so a rebuilt
// tarball with the same version installs the old one. `--local-sapporta`
// therefore defaults to a unique prerelease version; CI should pass its own.
// The timestamp in it carries the `050505` marker, as the staged-tree scan
// asks of any long digit run, joined by `-` rather than `.`: a numeric
// prerelease identifier may not start with a zero.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  deliberatelyShippedFiles,
  packedFiles,
  scanFiles,
  shippedFixturesAndTests,
} from "./pii-scan.mjs";

/**
 * A refusal, which the top level prints; `finally` still removes the staging
 * copy. Declared before the top level, whose `catch` reads it.
 */
class PackError extends Error {}

const root = path.resolve(import.meta.dirname, "..");
const { values: options } = parseArgs({
  options: {
    out: { type: "string", default: root },
    version: { type: "string" },
    "local-sapporta": { type: "boolean", default: false },
  },
});
const localSapporta = options["local-sapporta"];
const outDir = path.resolve(options.out);

const manifest = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const linked = linkedPackages(manifest.dependencies);
const version =
  options.version ??
  (localSapporta
    ? `${manifest.version}-local-050505${Date.now()}`
    : manifest.version);

let staging = null;
try {
  for (const built of [
    "dist/server/index.js",
    "dist/frontend/index.js",
    "dist/app/index.html",
  ]) {
    if (!existsSync(path.join(root, built))) {
      fail(`${built} is missing. Run pnpm build first.`);
    }
  }
  if (linked.size > 0 && !localSapporta) {
    fail(
      `Sapporta is linked from a local checkout (${[...linked.keys()].join(", ")}).\n` +
        "A tarball packed now would name registry versions that lack the checkout's changes.\n" +
        "Publish Sapporta and run `pnpm package-sources:use-npm` first; to verify a tarball\n" +
        "against the checkout instead, pass --local-sapporta (never published).",
    );
  }

  staging = mkdtempSync(path.join(tmpdir(), "dbu6-pack-"));
  for (const file of packedFiles(root)) {
    const target = path.join(staging, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, file), target);
  }
  writeFileSync(
    path.join(staging, "package.json"),
    JSON.stringify(publishedManifest(), null, 2) + "\n",
  );

  mkdirSync(outDir, { recursive: true });
  // One dbu6 tarball per out directory: an earlier pack's would be mistaken
  // for this one.
  for (const file of readdirSync(outDir)) {
    if (/^dbu6-.*\.tgz$/.test(file)) rmSync(path.join(outDir, file));
  }
  rmSync(path.join(outDir, "overrides.json"), { force: true });
  if (localSapporta) {
    packLinkedPackages();
  } else {
    npm(["install", "--package-lock-only", "--ignore-scripts"], staging);
    npm(["shrinkwrap"], staging);
  }
  scanStaging();

  const [{ filename }] = JSON.parse(
    npm(
      ["pack", "--json", "--ignore-scripts", "--pack-destination", outDir],
      staging,
    ),
  );
  console.log(path.join(outDir, filename));
} catch (error) {
  if (!(error instanceof PackError)) throw error;
  console.error(`pack: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (staging !== null) rmSync(staging, { recursive: true, force: true });
}

/**
 * The staged tree, which is exactly the tarball's content, under the same
 * rules as `pii-scan --pack`, plus the link guard on the manifest and
 * shrinkwrap that were generated here rather than copied.
 */
function scanStaging() {
  const files = readdirSync(staging, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(staging, path.join(entry.parentPath, entry.name)),
    );
  const findings = [
    ...shippedFixturesAndTests(files, deliberatelyShippedFiles(root)),
    ...scanFiles(staging, files, { forbidLinks: true }),
  ];
  if (findings.length === 0) return;
  for (const { file, line, rule, token } of findings) {
    console.error(`${file}:${line}: ${rule}: ${token}`);
  }
  fail(
    `${findings.length} finding(s) in the staged tarball; nothing was packed.`,
  );
}

function publishedManifest() {
  const {
    devDependencies,
    scripts,
    packageManager,
    private: _private,
    ...published
  } = manifest;
  const dependencies = { ...published.dependencies };
  for (const [name, { version: linkedVersion }] of linked) {
    dependencies[name] = linkedVersion;
  }
  return { ...published, version, dependencies };
}

/** name -> { dir, version } for each dependency that is a `link:` to a checkout. */
function linkedPackages(dependencies) {
  const found = new Map();
  for (const [name, spec] of Object.entries(dependencies)) {
    if (!spec.startsWith("link:")) continue;
    const dir = path.resolve(root, spec.slice("link:".length));
    const { version: linkedVersion } = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    found.set(name, { dir, version: linkedVersion });
  }
  return found;
}

/**
 * Tarballs of the linked packages, and the npm `overrides` that make a scratch
 * project install them wherever a `@sapporta/*` version is asked for.
 */
function packLinkedPackages() {
  const tarballDir = path.join(outDir, "sapporta");
  rmSync(tarballDir, { recursive: true, force: true });
  mkdirSync(tarballDir, { recursive: true });
  const overrides = {};
  for (const [name, { dir }] of linked) {
    const before = new Set(readdirSync(tarballDir));
    execFileSync("pnpm", ["pack", "--pack-destination", tarballDir], {
      cwd: dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const [tarball] = readdirSync(tarballDir).filter(
      (file) => !before.has(file),
    );
    if (!tarball) fail(`pnpm pack wrote no tarball for ${name}`);
    overrides[name] = `file:${path.join(tarballDir, tarball)}`;
  }
  writeFileSync(
    path.join(outDir, "overrides.json"),
    JSON.stringify(overrides, null, 2) + "\n",
  );
}

function npm(args, cwd) {
  // The binary, not a shell's `npm`: the owner's shell defines a function of
  // that name that refuses to run. execFile never goes through a shell.
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function fail(message) {
  throw new PackError(message);
}
