// Run with `pnpm test:scripts` (node --test "scripts/*.test.mjs").
//
// This file is itself scanned, so every planted value is assembled at run
// time: the source never holds an unmarked digit run.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deliberatelyShippedFiles,
  findLocalLinks,
  isRoundAmount,
  loadAllowlist,
  loadVocabulary,
  nonRoundAmounts,
  scanFile,
  shippedFixturesAndTests,
  trackedFiles,
  scanFiles,
  unmarkedDigitRuns,
  zoneOf,
} from "./pii-scan.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = "custom-built-parsers/sample-bank-csv/fixtures/sanitized-statement.csv";
const PARSER_TEST = "custom-built-parsers/sample-bank-csv/parser_test.py";
const vocabulary = new Set(["date", "narration", "amount", "upi", "customer", "name"]);

const UNMARKED_DIGITS = ["4719", "3826", "51"].join("");
const NON_ROUND_AMOUNT = ["4,7", "19.38"].join("");

const CLEAN = [
  "Date,Narration,Amount",
  "01/07/26,UPI-sample-payee-050505,1000.00",
  "02/07/26,NOPII CUSTOMER NAME 0505055555,\"2,500.00\"",
  "",
].join("\n");

function scan(file, text, options = { vocabulary }) {
  return scanFile(file, Buffer.from(text), options);
}

test("a fixture that follows AGENTS.md is clean", () => {
  assert.deepEqual(scan(FIXTURE, CLEAN), []);
});

test("a planted non-round amount fails, with file and line", () => {
  const planted = `${CLEAN}03/07/26,UPI-sample-payee-050505,"${NON_ROUND_AMOUNT}"\n`;
  assert.deepEqual(scan(FIXTURE, planted), [
    { file: FIXTURE, line: 4, rule: "amount", token: NON_ROUND_AMOUNT },
  ]);
  // The same value in a parser's test is caught too.
  const inTest = `assert row.amount == Decimal("${NON_ROUND_AMOUNT.replace(",", "")}")\n`;
  assert.equal(scan(PARSER_TEST, inTest)[0]?.rule, "amount");
});

test("a planted unmarked long digit string fails, anywhere in the tree", () => {
  const planted = `${CLEAN}03/07/26,UPI-sample-${UNMARKED_DIGITS},1000.00\n`;
  assert.deepEqual(scan(FIXTURE, planted), [
    { file: FIXTURE, line: 4, rule: "digits", token: UNMARKED_DIGITS },
  ]);
  const inSource = `const account = "${UNMARKED_DIGITS}";\n`;
  assert.equal(scan("src/server/modules/sample.ts", inSource)[0]?.rule, "digits");
});

test("a narration word outside the vocabulary fails in a fixture only", () => {
  const planted = `${CLEAN}03/07/26,UPI-Zebedee-050505,1000.00\n`;
  assert.deepEqual(scan(FIXTURE, planted), [
    { file: FIXTURE, line: 4, rule: "text", token: "Zebedee" },
  ]);
  assert.deepEqual(scan(PARSER_TEST, "# Zebedee wrote this\n"), []);
});

test("the allowlist is an exact token in matching files", () => {
  const planted = `${CLEAN}03/07/26,UPI-sample-payee-050505,"${NON_ROUND_AMOUNT}"\n`;
  const allow = (file) => ({
    vocabulary,
    allowlist: [{ file, token: NON_ROUND_AMOUNT, reason: "test" }],
  });
  assert.deepEqual(scan(FIXTURE, planted, allow("custom-built-parsers/sample-bank-*")), []);
  assert.equal(scan(FIXTURE, planted, allow("custom-built-parsers/other-bank-*")).length, 1);
  assert.deepEqual(scan(PARSER_TEST, `x = "${UNMARKED_DIGITS}"  # pii-scan:allow invented\n`), []);
});

test("digit runs that are not identifiers pass", () => {
  for (const line of [
    "opening = 100000",
    "max-age=31536000",
    "limit is 131072 bytes",
    "070726   NOPII MERCH",
    "seed(20250901)",
    "Ref 000000000000000",
    "--sap-fg: #141616;",
    "sha a3f26728" + "16bc91",
    "took 1.23456789 s",
    "FDRLR050505050505050505",
  ]) {
    assert.deepEqual(unmarkedDigitRuns(line), [], line);
  }
  // In statement data, `#` before digits is a reference, not a colour.
  assert.equal(unmarkedDigitRuns("Ref #141616", { isStatementData: true }).length, 1);
});

test("round means whole; versions and rates are not amounts", () => {
  assert.equal(isRoundAmount("1,630.00"), true);
  assert.equal(isRoundAmount("4,98,370.00"), true);
  assert.equal(isRoundAmount("3.75"), true);
  assert.equal(isRoundAmount("1,630.5"), false);
  assert.deepEqual(nonRoundAmounts('xlwt==1.3.0 python>=3.9 slice[16,24] "12,345.67"'), []);
  assert.deepEqual(nonRoundAmounts("paid 250.75 and 99.10"), ["250.75", "99.10"]);
});

test("zones", () => {
  assert.equal(zoneOf(FIXTURE), "fixture");
  assert.equal(zoneOf("custom-built-parsers/x/fixtures/generate_fixture.py"), "strict");
  assert.equal(zoneOf(PARSER_TEST), "strict");
  assert.equal(zoneOf("src/server/modules/values/Money.test.ts"), "source");
  assert.equal(zoneOf("pnpm-lock.yaml"), "skip");
  assert.equal(zoneOf("migrations/meta/0000_snapshot.json"), "skip");
  assert.equal(zoneOf("dist/app/assets/index.js"), "built");
});

test("a binary fixture the scan cannot read is a finding", () => {
  const findings = scanFile(FIXTURE.replace(".csv", ".pdf"), Buffer.from([0x25, 0x50, 0x00, 0x01]));
  assert.equal(findings[0]?.rule, "unreadable");
});

test("publishing with link: dependencies or home paths fails", () => {
  const manifest = Buffer.from(
    ['{ "dependencies": {', '  "@sapporta/server": "link:../sapporta/packages/core",', '  "zod": "4.4.3"', "} }"].join("\n"),
  );
  assert.deepEqual(findLocalLinks("package.json", manifest).map((f) => f.line), [2]);
  const workspace = Buffer.from('overrides:\n  "zod": "4.4.3"\n  "x": "/Users/sample/x"\n');
  assert.deepEqual(findLocalLinks("pnpm-workspace.yaml", workspace).map((f) => f.line), [3]);
  assert.deepEqual(findLocalLinks("package.json", Buffer.from('{ "zod": "4.4.3" }')), []);
});

test("a fixture or test in the package is a finding", () => {
  const shipped = shippedFixturesAndTests([
    "custom-built-parsers/x/parser.py",
    "custom-built-parsers/x/parser_test.py",
    FIXTURE,
    "dist/server/app.test.js",
  ]);
  assert.equal(shipped.length, 3);
  // A test that package.json's `files` names by path is shipped on purpose.
  const deliberate = shippedFixturesAndTests(
    ["docs/examples/report/api.test.ts", FIXTURE],
    ["docs/examples/report/api.test.ts"],
  );
  assert.deepEqual(deliberate.map((f) => f.file), [FIXTURE]);
});

test("package.json names the shipped guide and the worked example's test by path", () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.deepEqual(deliberatelyShippedFiles(rootDir), ["DBU6-BOOKS.md", "docs/examples/report/api.test.ts"]);
});

test("the tracked tree is clean", () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.ok(loadVocabulary().size > 0);
  assert.ok(loadAllowlist().every((entry) => entry.reason));
  const findings = scanFiles(rootDir, trackedFiles(rootDir));
  assert.deepEqual(
    findings.map(({ file, line, rule }) => `${file}:${line}: ${rule}`),
    [],
  );
});
