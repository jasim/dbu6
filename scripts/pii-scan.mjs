#!/usr/bin/env node
// The AGENTS.md "No PII" scan, as code. An npm publish cannot be taken back,
// so `pnpm release` (scripts/release.mjs) runs this over exactly what `npm
// pack` would include and scripts/pack.mjs runs it again over the staged
// tarball, and CI runs it over the git tracked tree.
//
//   node scripts/pii-scan.mjs --tracked            the git tracked tree (CI)
//   node scripts/pii-scan.mjs --pack               what `npm pack` would ship,
//                                                  plus the link: guard
//   node scripts/pii-scan.mjs --tracked --forbid-links
//   node scripts/pii-scan.mjs path/to/file ...     just these files
//
// Three rules, from AGENTS.md:
//
//   digits  a run of six or more digits without the `050505` marker
//   amount  a money-shaped number that is not a round whole number
//   text    a word in a statement fixture that is neither built on
//           `sample` / `NOPII` nor in scripts/pii-scan-vocabulary.txt
//
// Which rule runs where is decided by `zoneOf` — scope first, allowlist last:
//
//   skip     generated files whose digits are hashes and ids by construction
//            (SKIPPED_FILES, each with its reason), images, audio, video
//   built    dist/ — compiled from tracked source that CI scans, bundled
//            with third-party code full of long numbers; listed, not scanned
//   fixture  statement data under a fixtures/ directory: digits, amount, text.
//            .xls workbooks are read too: their strings, and numeric cells
//   strict   everything else under custom-built-parsers/,
//            the seed's render-statements.py and user-config.example/ — parsers,
//            their tests, guides: digits, amount. These are the files written
//            with a real statement open
//   source   the rest (application code and its tests, docs, config): digits
//            only. It is full of legitimate decimals (versions, ratios, CSS,
//            Money arithmetic tested to the paisa) and is not built against
//            real statements
//
// Exceptions live in scripts/pii-scan-allowlist.json, as
// `{ "file", "token", "reason" }`: an exact token in one file (`*` in "file"
// matches any run of characters, for a value a parser's files share). A line can also carry
// `pii-scan:allow` in a comment. Both are for invented values that have to
// break a rule to exercise a parser (paise, a percentage); a real value is
// never allowlisted, it is replaced.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VOCABULARY_FILE = path.join(SCRIPT_DIR, "pii-scan-vocabulary.txt");
const ALLOWLIST_FILE = path.join(SCRIPT_DIR, "pii-scan-allowlist.json");

export const MARKER = "050505";
const INLINE_ALLOW = "pii-scan:allow";

/** Generated files skipped whole. Every entry says why its digits are safe. */
export const SKIPPED_FILES = [
  [/^scripts\/pii-scan-allowlist\.json$/, "the reviewed exceptions themselves"],
  [/(^|\/)pnpm-lock\.yaml$/, "lockfile: integrity hashes and versions"],
  [/(^|\/)npm-shrinkwrap\.json$/, "lockfile: integrity hashes and versions"],
  [/(^|\/)migrations\/meta\//, "drizzle snapshots: generated ids and timestamps"],
];

const MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz",
  ".mp3", ".wav", ".mp4", ".webm", ".mov",
  ".woff", ".woff2", ".ttf", ".otf",
]);

const STRICT_ROOTS = [
  "custom-built-parsers/",
  "src/server/seed/render-statements.py",
  "user-config.example/",
];

const TEST_FILE = /(\.test\.[cm]?[jt]sx?$)|(_test\.py$)|((^|\/)__tests__\/)/;
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".html",
]);

/** @returns {"skip" | "built" | "fixture" | "strict" | "source"} */
export function zoneOf(file) {
  const normalized = file.split(path.sep).join("/");
  const extension = path.extname(normalized).toLowerCase();
  if (MEDIA_EXTENSIONS.has(extension)) return "skip";
  if (SKIPPED_FILES.some(([pattern]) => pattern.test(normalized))) return "skip";
  if (/^dist\//.test(normalized)) return "built";
  if (/(^|\/)fixtures\//.test(normalized) && !CODE_EXTENSIONS.has(extension)) {
    return "fixture";
  }
  if (STRICT_ROOTS.some((root) => normalized.startsWith(root))) return "strict";
  return "source";
}

const RULES_BY_ZONE = {
  skip: [],
  built: [],
  fixture: ["digits", "amount", "text"],
  strict: ["digits", "amount"],
  source: ["digits"],
};

// ---------------------------------------------------------------------------
// Rules. Each takes one line and returns the offending tokens.

/** Runs of six or more digits that do not carry the marker. */
export function unmarkedDigitRuns(line, { isStatementData = false } = {}) {
  const found = [];
  for (const match of line.matchAll(/\d{6,}/g)) {
    const run = match[0];
    const start = match.index;
    const end = start + run.length;
    if (run.includes(MARKER)) continue;
    // One digit repeated: the bank's own placeholder, carries nothing.
    if (/^(\d)\1+$/.test(run)) continue;
    if (isCountingSequence(run)) continue;
    // A round amount written without separators (100000, 31536000).
    if (BigInt(run) % 100n === 0n) continue;
    if (isPowerOfTwo(BigInt(run))) continue;
    if (isCalendarDate(run)) continue;
    // The fractional part of a decimal (a timestamp, a ratio).
    if (/\d\.$/.test(line.slice(0, start))) continue;
    // Part of a lowercase hex word that has letters in it: a hash.
    const word = hexWordAround(line, start, end);
    if (word && /[a-f]/.test(word)) continue;
    // A seven-digit abbreviated commit hash, named as one.
    if (run.length === 7 && /commit\s+`?$/i.test(line.slice(0, start))) continue;
    // A colour. Not in statement data: `#123456` in a narration is a reference.
    if (!isStatementData && line[start - 1] === "#" && (run.length === 6 || run.length === 8)) {
      continue;
    }
    // A Unix time, named as one (terminal recordings carry them).
    if (run.length === 10 && /timestamp"?\s*[:=]\s*$/i.test(line.slice(0, start))) continue;
    found.push(run);
  }
  return found;
}

function hexWordAround(line, start, end) {
  let from = start;
  let to = end;
  while (from > 0 && /[0-9A-Za-z]/.test(line[from - 1])) from -= 1;
  while (to < line.length && /[0-9A-Za-z]/.test(line[to])) to += 1;
  const word = line.slice(from, to);
  return word.length >= 7 && /^[0-9a-f]+$/.test(word) ? word : undefined;
}

function isPowerOfTwo(value) {
  return value > 0n && (value & (value - 1n)) === 0n;
}

/** DDMMYY, YYMMDD, DDMMYYYY or YYYYMMDD. Statements print dates this way. */
function isCalendarDate(run) {
  const valid = (day, month) =>
    Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31;
  if (run.length === 6) {
    return valid(run.slice(0, 2), run.slice(2, 4)) || valid(run.slice(4, 6), run.slice(2, 4));
  }
  if (run.length === 8) {
    const century = (year) => /^(19|20)/.test(year);
    return (
      (century(run.slice(4)) && valid(run.slice(0, 2), run.slice(2, 4))) ||
      (century(run.slice(0, 4)) && valid(run.slice(6, 8), run.slice(4, 6)))
    );
  }
  return false;
}

// Money-shaped: grouped with commas (western or Indian), or exactly two
// decimals. Not part of a version (1.3.0), a longer decimal, or an identifier.
const AMOUNT_TOKEN =
  /(?<![\w.,])(?:\d{1,3}(?:,\d{2,3})*,\d{3}(?:\.\d{1,2})?|\d+\.\d{2})(?![\w]|[.,]\d)/g;

/** Money-shaped numbers that are not round whole numbers. */
export function nonRoundAmounts(line) {
  const found = [];
  for (const match of line.matchAll(AMOUNT_TOKEN)) {
    if (!isRoundAmount(match[0])) found.push(match[0]);
  }
  return found;
}

/**
 * Round means whole: no paise. Sums and running balances of whole amounts
 * stay whole, so a fixture that follows AGENTS.md never trips this, and a
 * statement copied from a bank almost always does. Under ten it is a rate, a
 * percentage or a tolerance rather than an amount.
 */
export function isRoundAmount(token) {
  if (isCountingSequence(token)) return true;
  const [whole, fraction = ""] = token.replaceAll(",", "").split(".");
  if (BigInt(whole) < 10n) return true;
  return !/[1-9]/.test(fraction);
}

/** 12,345.67 or 123456: a documentation example nobody's bank printed. */
function isCountingSequence(token) {
  const digits = token.replace(/\D/g, "");
  return digits.length >= 5 && "12345678901234567890".includes(digits);
}

/** Words that are neither `sample` / `NOPII` based nor in the vocabulary. */
export function unknownWords(line, vocabulary) {
  const found = [];
  // A compound built on the markers passes whole: `UPI-sample-payee-050505`,
  // `sample@example.com`.
  for (const compound of line.matchAll(/[A-Za-z0-9_@.-]+/g)) {
    if (/sample|nopii/i.test(compound[0])) continue;
    for (const match of compound[0].matchAll(/[A-Za-z]{2,}/g)) {
      const word = match[0].toLowerCase();
      if (/^x+$/.test(word)) continue; // a mask
      if (vocabulary.has(word)) continue;
      found.push(match[0]);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Scanning

/**
 * @param {string} file     path relative to the repo root, for zoning
 * @param {Buffer} content
 * @param {{ vocabulary?: Set<string>, allowlist?: Array<{file:string,token:string}> }} options
 * @returns {Array<{ file, line, rule, token }>}
 */
export function scanFile(file, content, options = {}) {
  const vocabulary = options.vocabulary ?? new Set();
  const allowlist = options.allowlist ?? [];
  const zone = zoneOf(file);
  const rules = RULES_BY_ZONE[zone];
  if (rules.length === 0) return [];

  const extension = path.extname(file).toLowerCase();
  const isStatementData = zone === "fixture";
  const workbook = extension === ".xls" ? xlsLines(content) : undefined;
  const lines = workbook ? [...workbook.strings, ...workbook.cells] : textLines(content);
  if (lines === undefined) {
    return [{ file, line: 0, rule: "unreadable", token: "binary file the scan cannot read" }];
  }
  // A numeric cell is an amount or a date serial, never an identifier (banks
  // store those as text), so only the amount rule reads it.
  const firstCell = workbook ? workbook.strings.length : Infinity;

  const allowed = new Set(
    allowlist
      .filter((entry) => globMatches(entry.file, file))
      .map((entry) => entry.token),
  );
  const findings = [];
  lines.forEach((line, index) => {
    if (line.includes(INLINE_ALLOW)) return;
    const hits = [];
    if (rules.includes("digits") && index < firstCell) {
      for (const token of unmarkedDigitRuns(line, { isStatementData })) hits.push(["digits", token]);
    }
    if (rules.includes("amount")) {
      for (const token of nonRoundAmounts(line)) hits.push(["amount", token]);
    }
    if (rules.includes("text") && index < firstCell) {
      for (const token of unknownWords(line, vocabulary)) hits.push(["text", token]);
    }
    for (const [rule, token] of hits) {
      if (allowed.has(token)) continue;
      findings.push({ file, line: index + 1, rule, token });
    }
  });
  return findings;
}

/** `*` matches any run of characters, `/` included. */
function globMatches(pattern, file) {
  const source = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${source}$`).test(file);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textLines(content) {
  // A NUL byte means a binary format this scan has no reader for.
  if (content.includes(0)) return undefined;
  return content.toString("utf8").split(/\r?\n/);
}

/**
 * A BIFF8 workbook as scannable lines: every string in the file (8-bit and
 * UTF-16 runs, which is how the shared string table stores them), then every
 * numeric cell printed as money so the amount rule reads it. "Line" numbers
 * for an .xls are positions in strings-then-cells, not rows.
 * @returns {{ strings: string[], cells: string[] } | undefined}
 */
export function xlsLines(content) {
  const bof = content.indexOf(Buffer.from([0x09, 0x08, 0x10, 0x00, 0x00, 0x06]));
  if (bof === -1) return undefined;

  const strings = [...asciiRuns(content), ...utf16Runs(content)];
  const lines = [];

  let offset = bof;
  while (offset + 4 <= content.length) {
    const id = content.readUInt16LE(offset);
    const length = content.readUInt16LE(offset + 2);
    const data = offset + 4;
    if (id === 0 && length === 0) break;
    if (data + length > content.length) break;
    if (id === 0x0203 && length === 14) {
      lines.push(cellText(content.readDoubleLE(data + 6)));
    } else if (id === 0x027e && length === 10) {
      lines.push(cellText(rkValue(content.readInt32LE(data + 6))));
    } else if (id === 0x00bd && length >= 6) {
      for (let at = data + 4; at + 6 <= data + length - 2; at += 6) {
        lines.push(cellText(rkValue(content.readInt32LE(at + 2))));
      }
    }
    offset = data + length;
  }
  return { strings, cells: lines };
}

function rkValue(rk) {
  const value = rk & 2 ? rk >> 2 : rkDouble(rk);
  return rk & 1 ? value / 100 : value;
}

function rkDouble(rk) {
  const buffer = Buffer.alloc(8);
  buffer.writeInt32LE(rk & ~3, 4);
  return buffer.readDoubleLE(0);
}

function cellText(value) {
  return value.toFixed(2);
}

function asciiRuns(content) {
  return content.toString("latin1").match(/[\x20-\x7e]{3,}/g) ?? [];
}

function utf16Runs(content) {
  const runs = [];
  for (const parity of [0, 1]) {
    const even = content.subarray(parity, content.length - ((content.length - parity) % 2));
    runs.push(...(even.toString("utf16le").match(/[\x20-\x7e]{3,}/g) ?? []));
  }
  return runs;
}

// ---------------------------------------------------------------------------
// The link: guard. A package published with `link:` or `file:` dependencies,
// or with a path into someone's home directory, cannot be installed.

const LINK_GUARDED = /(^|\/)(package\.json|pnpm-workspace\.yaml|npm-shrinkwrap\.json)$/;

export function isLinkGuarded(file) {
  return LINK_GUARDED.test(file.split(path.sep).join("/"));
}

/** @returns {Array<{ file, line, rule, token }>} */
export function findLocalLinks(file, content) {
  const findings = [];
  content
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const match =
        line.match(/["']?(?:link|file):[^"'\s]+/) ??
        line.match(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^"'\s]*/);
      if (match) {
        findings.push({ file, line: index + 1, rule: "local-link", token: "link:/file:/home path" });
      }
    });
  return findings;
}

// ---------------------------------------------------------------------------
// File lists

export function trackedFiles(rootDir) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: rootDir, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

export function packedFiles(rootDir) {
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const [pack] = JSON.parse(output);
  return pack.files.map((entry) => entry.path);
}

/**
 * A shipped fixture or test is a finding by itself: D6 keeps them out. The
 * exception is a test that package.json's `files` names by its exact path
 * (the worked example's test, which a project copies in), which is shipped on
 * purpose.
 */
export function shippedFixturesAndTests(files, deliberate = []) {
  const allowed = new Set(deliberate);
  return files
    .filter((file) => !allowed.has(file))
    .filter((file) => /(^|\/)fixtures\//.test(file) || TEST_FILE.test(file))
    .map((file) => ({ file, line: 0, rule: "shipped", token: "fixture or test in the package" }));
}

/** The exact file paths package.json's `files` lists, as opposed to directories and patterns. */
export function deliberatelyShippedFiles(rootDir) {
  const { files = [] } = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  return files.filter(
    (entry) => !entry.startsWith("!") && !/[*?]/.test(entry) && existsSync(path.join(rootDir, entry)) &&
      statSync(path.join(rootDir, entry)).isFile(),
  );
}

export function loadVocabulary(file = VOCABULARY_FILE) {
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
      .filter(Boolean),
  );
}

export function loadAllowlist(file = ALLOWLIST_FILE) {
  if (!existsSync(file)) return [];
  const entries = JSON.parse(readFileSync(file, "utf8"));
  for (const entry of entries) {
    if (!entry.file || !entry.token || !entry.reason) {
      throw new Error(`${file}: every entry needs file, token and reason.`);
    }
  }
  return entries;
}

export function scanFiles(rootDir, files, { forbidLinks = false } = {}) {
  const options = { vocabulary: loadVocabulary(), allowlist: loadAllowlist() };
  const findings = [];
  for (const file of files) {
    const absolute = path.join(rootDir, file);
    if (!existsSync(absolute)) continue; // deleted in the working tree
    const content = readFileSync(absolute);
    findings.push(...scanFile(file, content, options));
    if (forbidLinks && isLinkGuarded(file)) {
      findings.push(...findLocalLinks(file, content));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI

function main(argv) {
  const rootDir = path.resolve(SCRIPT_DIR, "..");
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const paths = argv.filter((arg) => !arg.startsWith("--"));
  const showTokens = !flags.has("--hide-tokens");

  let files;
  let findings = [];
  let forbidLinks = flags.has("--forbid-links");
  if (flags.has("--pack")) {
    files = packedFiles(rootDir);
    findings.push(...shippedFixturesAndTests(files, deliberatelyShippedFiles(rootDir)));
    forbidLinks = true;
    // The workspace file and the workspace manifests are not shipped, but
    // they decide what the build resolved: a Sapporta linked from a local
    // checkout must not be what gets published.
    const shipped = new Set(files);
    for (const file of trackedFiles(rootDir)) {
      if (!isLinkGuarded(file) || shipped.has(file)) continue;
      if (!existsSync(path.join(rootDir, file))) continue;
      findings.push(...findLocalLinks(file, readFileSync(path.join(rootDir, file))));
    }
  } else if (flags.has("--tracked")) {
    files = trackedFiles(rootDir);
  } else if (paths.length > 0) {
    files = paths.map((file) => path.relative(rootDir, path.resolve(file)));
  } else {
    console.error("Usage: pii-scan.mjs --tracked | --pack | <file>...  [--forbid-links] [--hide-tokens]");
    return 2;
  }

  findings.push(...scanFiles(rootDir, files, { forbidLinks }));

  for (const { file, line, rule, token } of findings) {
    console.error(`${file}:${line}: ${rule}${showTokens ? `: ${token}` : ""}`);
  }
  if (findings.length > 0) {
    console.error(
      `\npii-scan: ${findings.length} finding(s) in ${files.length} file(s). ` +
        `See the header of scripts/pii-scan.mjs and AGENTS.md ("No PII").`,
    );
    return 1;
  }
  console.log(`pii-scan: ${files.length} file(s) clean.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
