#!/usr/bin/env node

// Reports where dbu6 stands between releases, for the release train in
// ../sapporta-devtools, which releases Sapporta, nuabase and dbu6 in
// dependency order and asks every repository the same question through the
// same script. It prints one JSON object on stdout and nothing else:
//
//   pnpm release:status
//
//   { "packages": [ {
//       "name": "@dbu6/app",
//       "version": "<version in package.json>",
//       "published": <bool>,
//       "dependencies": [<names in dependencies and peerDependencies>],
//       "pendingBump": "patch" | "minor" | "major" | null,
//       "unnamedChanges": [ { "hash": "<short>", "subject": "..." } ]
//   } ] }
//
// There is one entry: the repository is one package. @dbu6/create is released
// with it at the same version and is not listed on its own, but it counts
// towards `published`, which is true only when both @dbu6/app and
// @dbu6/create are on npm at this version (scripts/npm-published.mjs).
//
// `pendingBump` is the highest bump that the changesets in .changeset/ ask
// for @dbu6/app, or null when there are none. `unnamedChanges` lists the
// commits since the last release that no changeset accounts for, so that the
// train can say that something would go out unversioned. It is empty
// whenever a changeset is pending, because the next version then carries
// those commits anyway. The last release is marked by the newest commit whose
// subject starts with "Version packages" (the commit the train makes); before
// the first such commit, by the `v<version>` tag; without either, the whole
// history counts. A commit that touches only CHANGELOG.md or .changeset/ is
// release bookkeeping and is not listed.
//
// A failure (git, or an npm registry error other than a 404) exits non-zero
// with the reason on stderr, so the train never reads a guess.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { publishedPackages } from "./npm-published.mjs";

const root = path.resolve(import.meta.dirname, "..");
const BUMPS = ["patch", "minor", "major"];
const VERSION_COMMIT_PREFIX = "Version packages";

try {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const { name, version } = manifest;
  const pendingBump = pendingBumpFor(name);
  const status = {
    packages: [
      {
        name,
        version,
        published: publishedPackages(version).every((entry) => entry.published),
        dependencies: [
          ...new Set([
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
          ]),
        ],
        pendingBump,
        unnamedChanges: pendingBump === null ? unnamedChanges(version) : [],
      },
    ],
  };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} catch (error) {
  console.error(
    `release:status: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

/**
 * The highest bump the pending changesets give `packageName`. A changeset is
 * a Markdown file whose front matter maps package names, quoted or not, to a
 * bump:
 *
 *   ---
 *   "@dbu6/app": minor
 *   ---
 *
 *   One-line summary.
 */
function pendingBumpFor(packageName) {
  const dir = path.join(root, ".changeset");
  let highest = -1;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const text = readFileSync(path.join(dir, file), "utf8");
    const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontMatter) continue;
    for (const line of frontMatter[1].split(/\r?\n/)) {
      const entry = line.match(/^\s*(["']?)(.+?)\1\s*:\s*(\w+)\s*$/);
      if (!entry || entry[2] !== packageName) continue;
      const bump = BUMPS.indexOf(entry[3]);
      if (bump === -1) {
        throw new Error(`.changeset/${file}: unknown bump "${entry[3]}".`);
      }
      highest = Math.max(highest, bump);
    }
  }
  return highest === -1 ? null : BUMPS[highest];
}

/** Commits since the last release that change more than release bookkeeping. */
function unnamedChanges(version) {
  const marker = lastReleaseCommit(version);
  const range = marker ? `${marker}..HEAD` : "HEAD";
  // Each commit is a NUL, its hash and subject, then the files it touches,
  // one per line. A merge lists no files and so is left out; the commits it
  // brings in are listed themselves.
  const log = git(["log", "--format=%x00%h%x09%s", "--name-only", range]);
  const changes = [];
  for (const record of log.split("\0").slice(1)) {
    const [header, ...files] = record.split("\n").filter(Boolean);
    const [hash, ...subject] = header.split("\t");
    if (files.some((file) => !isReleaseBookkeeping(file))) {
      changes.push({ hash, subject: subject.join("\t") });
    }
  }
  return changes;
}

function isReleaseBookkeeping(file) {
  return file === "CHANGELOG.md" || file.startsWith(".changeset/");
}

/**
 * The newest "Version packages" commit on HEAD, else the commit tagged
 * `v<version>`, else undefined. Subjects are matched here rather than with
 * `git log --grep`, which would also match the phrase in a message body.
 */
function lastReleaseCommit(version) {
  for (const line of git(["log", "--format=%H%x09%s"]).split("\n")) {
    const [hash, subject = ""] = line.split("\t");
    if (subject.startsWith(VERSION_COMMIT_PREFIX)) return hash;
  }
  const tag = `v${version}`;
  if (git(["tag", "--list", tag]).trim() === "") return undefined;
  return git(["rev-list", "-n", "1", tag]).trim();
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}
