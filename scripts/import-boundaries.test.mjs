// The import rules between the parts of src/, as one test (`pnpm test:scripts`,
// which `pnpm test` runs). It stands in for a lint rule: the repository has no
// ESLint, and a rule about which folder may import which needs only the import
// specifiers, not a linter.
//
//   src/shared         imports nothing else of ours
//   src/frontend       may import src/shared, and nothing from src/server
//   src/server         may import src/shared, and nothing from src/frontend
//   src/frontend-host  imports nothing else of ours (it is Node code that
//                      names the frontend by path, never by import)
//   src/cli            the `dbu6` command, above the rest of the Node side:
//                      may import src/server, src/shared and src/frontend-host
//
// The frontend rule is the one that matters: a server module pulled into the
// browser bundle would bring better-sqlite3 and the rest of Node with it.
//
// And the rule for our own reports (PLAN.md R1), below: they are written
// against the same two lists a project's reports are.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const srcDir = path.resolve(import.meta.dirname, "../src");
const MAY_IMPORT = {
  shared: [],
  frontend: ["shared"],
  server: ["shared"],
  "frontend-host": [],
  cli: ["server", "shared", "frontend-host"],
};

// import/export ... from "x", import("x"), and vitest's vi.mock("x") family.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.\w+\(\s*)(["'])([^"']+)\1/g;

function boundaryViolations(root = srcDir, mayImport = MAY_IMPORT) {
  const violations = [];
  for (const part of Object.keys(mayImport)) {
    for (const file of sourceFiles(path.join(root, part))) {
      for (const [, , specifier] of readFileSync(file, "utf8").matchAll(
        SPECIFIER,
      )) {
        if (!specifier.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), specifier);
        const targetPart = path.relative(root, target).split(path.sep)[0];
        if (targetPart === part || mayImport[part].includes(targetPart))
          continue;
        violations.push(
          `${path.relative(root, file)} imports ${specifier} (src/${part} may not import src/${targetPart})`,
        );
      }
    }
  }
  return violations;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mts|mjs)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("src/ parts import only what they may", () => {
  assert.deepEqual(boundaryViolations(), []);
});

test("an import of src/server from src/frontend is reported", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dbu6-boundaries-"));
  try {
    for (const part of Object.keys(MAY_IMPORT))
      mkdirSync(path.join(root, part));
    writeFileSync(
      path.join(root, "frontend/a.ts"),
      'import { x } from "../shared/index";\nimport { y } from "../server/paths.js";\n',
    );
    assert.deepEqual(boundaryViolations(root), [
      "frontend/a.ts imports ../server/paths.js (src/frontend may not import src/server)",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- Our own reports are written against what a project's are ---
//
// `dbu6/server` and `dbu6/frontend` are what we promise a project's reports.
// The report half of each is a module of its own (report-kit), which the
// index re-exports whole. A report of ours imports its side's kit, its own
// contract in src/shared, the files beside it, and nothing else: no other
// module of src/, and no package, since a project depends on dbu6 alone. If
// one of ours needs something, a project's will, and it becomes an export of
// the kit.

const REPORT_SIDES = [
  {
    index: "server/index.ts",
    kit: "server/report-kit.ts",
    dir: "server/app/reports",
    // Not reports: none.
    infrastructure: [],
    // The Checks reports show the import workflow's own findings (failing
    // balance checks, possible duplicates, the last reconciled statement),
    // which Review and Home show too. Their rule lives in the domain module,
    // once, so these four read it there. A project's report has no such
    // module to share; this is not a precedent for the others.
    exceptions: {
      "balance-assertions.ts": ["server/modules/reconciliation/index"],
      "draft-balance-assertions.ts": [
        "better-sqlite3",
        "server/modules/ledger-sql/index",
        "server/modules/accounts/index",
        "server/modules/drafts/index",
      ],
      "duplicate-drafts.ts": [
        "better-sqlite3",
        "server/modules/ledger-sql/index",
        "server/modules/reconciliation/index",
        "server/modules/drafts/index",
      ],
      "last-reconciled.ts": ["server/modules/journals/index"],
    },
  },
  {
    index: "frontend/index.ts",
    kit: "frontend/report-kit.ts",
    dir: "frontend/reports",
    // The Reports page and its list: the app's, not a report's.
    infrastructure: [
      "registry.tsx",
      "ReportsIndex.tsx",
      "createReportPrompt.ts",
      "CreateReport.tsx",
    ],
    exceptions: {},
  },
];

const stem = (file) => file.replace(/\.(js|ts|tsx)$/, "");

function specifiersOf(file) {
  return [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map(
    ([, , specifier]) => specifier,
  );
}

/** A specifier as a path under `root` without its extension, or the package. */
function resolved(root, file, specifier) {
  if (!specifier.startsWith(".")) return specifier;
  return stem(path.relative(root, path.resolve(path.dirname(file), specifier)));
}

function reportViolations(root = srcDir, sides = REPORT_SIDES) {
  const violations = [];
  for (const side of sides) {
    const index = readFileSync(path.join(root, side.index), "utf8");
    const kitStem = stem(side.kit);
    if (!/export \* from "\.\/report-kit(\.js)?";/.test(index)) {
      violations.push(`${side.index} must re-export all of ${side.kit}`);
    }
    // What the kit is made of is not a report, wherever it lives.
    const kitFile = path.join(root, side.kit);
    const kitSources = new Set(
      specifiersOf(kitFile).map((s) => resolved(root, kitFile, s)),
    );
    const isReportFile = (fileStem) =>
      fileStem.startsWith(`${side.dir}/`) &&
      !kitSources.has(fileStem) &&
      !side.infrastructure.some(
        (name) => fileStem === stem(`${side.dir}/${name}`),
      );

    for (const file of sourceFiles(path.join(root, side.dir))) {
      const relative = path.relative(root, file);
      if (/\.test\.\w+$/.test(relative) || !isReportFile(stem(relative)))
        continue;
      const allowed =
        side.exceptions[path.relative(path.join(root, side.dir), file)] ?? [];
      for (const specifier of specifiersOf(file)) {
        const target = resolved(root, file, specifier);
        if (
          target === kitStem ||
          target.startsWith("shared/") ||
          isReportFile(target) ||
          allowed.includes(target)
        )
          continue;
        violations.push(
          `${relative} imports ${specifier} (a report imports ${side.kit}, its contract and the files beside it)`,
        );
      }
    }
  }
  return violations;
}

test("our reports import only the report kit, their contract and their own files", () => {
  assert.deepEqual(reportViolations(), []);
});

test("a report that reaches past the kit is reported, as is a package", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dbu6-report-rule-"));
  try {
    const side = {
      index: "server/index.ts",
      kit: "server/report-kit.ts",
      dir: "server/app/reports",
      infrastructure: [],
      exceptions: {},
    };
    mkdirSync(path.join(root, side.dir), { recursive: true });
    const write = (file, text) => writeFileSync(path.join(root, file), text);
    write(side.index, 'export * from "./report-kit.js";\n');
    write(side.kit, 'export { textColumn } from "./app/reports/shared.js";\n');
    write(
      "server/app/reports/shared.ts",
      'import { x } from "../workflow-auth.js";\n',
    );
    write("server/app/reports/helper.ts", "");
    write(
      "server/app/reports/sample.ts",
      [
        'import { textColumn } from "../../report-kit.js";',
        'import { sampleContract } from "../../../shared/index.js";',
        'import { help } from "./helper.js";',
        'import { textColumn as direct } from "./shared.js";',
        'import { allRows } from "../../modules/ledger-sql/index.js";',
        'import Database from "better-sqlite3";',
      ].join("\n"),
    );
    assert.deepEqual(
      reportViolations(root, [side]).map((line) => line.split(" (")[0]),
      [
        "server/app/reports/sample.ts imports ./shared.js",
        "server/app/reports/sample.ts imports ../../modules/ledger-sql/index.js",
        "server/app/reports/sample.ts imports better-sqlite3",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
