import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * The backend's layering, enforced. DEVELOPMENT.md ("Backend layering") says
 * what each tier owns and must not contain; this table says which files make
 * up each module and where each module sits, and it is the one the tests check.
 *
 * A file may import from its own module, from any module in a lower tier, and
 * from a same-tier module it is listed as sitting `above`. When a module lists
 * `entries`, other modules import it only through those files. Imports of
 * packages (Sapporta, dbu6-shared, drizzle, node:*) are not checked here.
 *
 * An import that breaks the rules while code is being moved is listed in
 * KNOWN_VIOLATIONS with the PLAN.md task that removes it. The test fails on a
 * new violation and on a listed one that no longer occurs, so the list only
 * shrinks.
 *
 * Tiers, lowest first: 0 foundations, 1 values, 2 statement, 3 logic over
 * statements and journals, 4 ledger storage and the coding agent, 5 domain
 * workflows, 6 routes and reports.
 */

type Module = {
  name: string;
  tier: number;
  // Its files, relative to packages/api: "dir/" for a directory, otherwise a
  // file path without its extension, which also covers its tests
  // ("x/Money" holds x/Money.ts and x/Money.test.ts).
  files: readonly string[];
  // Same-tier modules this one sits above, and so may import.
  above?: readonly string[];
  // The only files other modules may import; any file when unset.
  entries?: readonly string[];
};

const MODULES: readonly Module[] = [
  // Tier 0: foundations.
  { name: "schema", tier: 0, files: ["schema/"] },
  { name: "user-data", tier: 0, files: ["user-data"] },
  // Scoped raw SQL and the auth type every store takes.
  {
    name: "ledger-sql",
    tier: 0,
    files: ["modules/ledger-sql/"],
    above: ["schema"],
    entries: ["modules/ledger-sql/index.ts", "modules/ledger-sql/testing.ts"],
  },

  // Tier 1: values.
  {
    name: "values",
    tier: 1,
    files: ["modules/values/"],
    entries: ["modules/values/index.ts"],
  },

  // Tier 2: the statement.
  {
    name: "statement",
    tier: 2,
    files: ["modules/statement/"],
    entries: ["modules/statement/index.ts"],
  },

  // Tier 3: logic over statements and journals, no storage.
  {
    name: "transaction-identity",
    tier: 3,
    files: ["modules/transaction-identity/"],
    entries: ["modules/transaction-identity/index.ts"],
  },
  {
    name: "categorization",
    tier: 3,
    files: ["modules/categorization/"],
    entries: ["modules/categorization/index.ts"],
  },
  {
    name: "gpay",
    tier: 3,
    files: ["modules/gpay/"],
    entries: ["modules/gpay/index.ts"],
  },
  {
    name: "journal-plan",
    tier: 3,
    files: ["modules/journal-plan/"],
    entries: ["modules/journal-plan/index.ts"],
  },
  {
    name: "statement-sources",
    tier: 3,
    files: ["modules/statement-sources/"],
    entries: ["modules/statement-sources/index.ts"],
  },

  // Tier 4: ledger storage, lowest first, and the coding agent beside it.
  {
    name: "accounts",
    tier: 4,
    files: ["modules/accounts/"],
    entries: ["modules/accounts/index.ts"],
  },
  {
    name: "journals",
    tier: 4,
    files: ["modules/journals/"],
    above: ["accounts"],
    entries: ["modules/journals/index.ts"],
  },
  {
    name: "reconciliation",
    tier: 4,
    files: ["modules/reconciliation/"],
    above: ["accounts", "journals"],
    entries: ["modules/reconciliation/index.ts"],
  },
  {
    name: "drafts",
    tier: 4,
    files: ["modules/drafts/"],
    above: ["accounts", "journals", "reconciliation"],
    entries: ["modules/drafts/index.ts"],
  },
  {
    name: "coding-agent",
    tier: 4,
    files: ["modules/coding-agent/"],
    entries: ["modules/coding-agent/index.ts"],
  },

  // Tier 5: domain workflows. They never import each other.
  {
    name: "statement-import",
    tier: 5,
    files: ["workflows/statement-import/"],
    entries: ["workflows/statement-import/index.ts"],
  },
  {
    name: "posting",
    tier: 5,
    files: ["workflows/posting"],
    entries: ["workflows/posting.ts"],
  },
  {
    name: "reclassification",
    tier: 5,
    files: ["workflows/reclassification"],
    entries: ["workflows/reclassification.ts"],
  },

  // Tier 6: routes, reports, and hosting.
  {
    name: "app",
    tier: 6,
    files: [
      "app/",
      "app",
      "boot",
      "mailer",
      "drizzle.config",
      "layering",
      "project-auth/",
      "authz/",
    ],
  },
];

// Imports that break the rules today, each removed by the PLAN.md task named.
const KNOWN_VIOLATIONS: readonly { from: string; to: string; task: string }[] =
  [];

const API_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "migrations"]);

function sourceFiles(directory = ""): string[] {
  return readdirSync(path.join(API_ROOT, directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
        return [];
      }
      return sourceFiles(relative);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
      ? [relative]
      : [];
  });
}

function holds(prefix: string, file: string): boolean {
  if (prefix.endsWith("/")) return file.startsWith(prefix);
  return file === `${prefix}.ts` || file.startsWith(`${prefix}.`);
}

// The module whose most specific `files` entry holds the file.
function moduleOf(file: string): Module | undefined {
  let found: { module: Module; length: number } | undefined;
  for (const module of MODULES) {
    for (const prefix of module.files) {
      if (holds(prefix, file) && prefix.length > (found?.length ?? -1)) {
        found = { module, length: prefix.length };
      }
    }
  }
  return found?.module;
}

// The package's own files a file imports, resolved to their paths.
function importedFiles(file: string, known: ReadonlySet<string>): string[] {
  const text = readFileSync(path.join(API_ROOT, file), "utf8");
  return ts
    .preProcessFile(text, true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((specifier) => specifier.startsWith("."))
    .flatMap((specifier) => {
      const target = path.posix.join(path.posix.dirname(file), specifier);
      const candidates = [
        target.replace(/\.js$/, ".ts"),
        `${target}.ts`,
        `${target}/index.ts`,
      ];
      const resolved = candidates.find((candidate) => known.has(candidate));
      return resolved === undefined ? [] : [resolved];
    });
}

function violation(from: Module, to: Module, target: string): string | null {
  if (from === to) return null;
  if (to.tier > from.tier) {
    return `${from.name} (tier ${from.tier}) imports ${to.name}, a higher tier (${to.tier})`;
  }
  if (to.tier === from.tier && !(from.above ?? []).includes(to.name)) {
    return `${from.name} imports ${to.name}, a tier ${to.tier} module it doesn't sit above`;
  }
  if (to.entries !== undefined && !to.entries.includes(target)) {
    return `${from.name} imports ${to.name} past its entries (${to.entries.join(", ")})`;
  }
  return null;
}

function key(edge: { from: string; to: string }): string {
  return `${edge.from} -> ${edge.to}`;
}

describe("backend layering", () => {
  const files = sourceFiles();
  const known = new Set(files);

  it("puts every file in a module", () => {
    expect(files.filter((file) => moduleOf(file) === undefined)).toEqual([]);
  });

  it("names same-tier modules that exist", () => {
    const byName = new Map(MODULES.map((module) => [module.name, module]));
    const wrong = MODULES.flatMap((module) =>
      (module.above ?? [])
        .filter((name) => byName.get(name)?.tier !== module.tier)
        .map((name) => `${module.name} above ${name}`),
    );
    expect(wrong).toEqual([]);
  });

  it("imports only downward, and through entries", () => {
    const found = new Map<string, string>();
    for (const file of files) {
      const from = moduleOf(file);
      if (from === undefined) continue;
      for (const target of importedFiles(file, known)) {
        const to = moduleOf(target);
        if (to === undefined) continue;
        const reason = violation(from, to, target);
        if (reason !== null) {
          found.set(key({ from: file, to: target }), reason);
        }
      }
    }

    const listed = new Set(KNOWN_VIOLATIONS.map(key));
    const unexpected = [...found]
      .filter(([edge]) => !listed.has(edge))
      .map(([edge, reason]) => `${edge}: ${reason}`);
    const resolved = [...listed].filter((edge) => !found.has(edge));
    expect({ unexpected, resolved }).toEqual({ unexpected: [], resolved: [] });
  });
});
