// The guides dbu6 ships for coding agents, by the name `npx dbu6 docs <name>`
// prints them under. A prompt or a contract description names a guide through
// `guideCommand`, never by its file: in a user's project the files are inside
// the installed package, under a node_modules that agent search tools skip.
//
// Each file is relative to the package directory, for the command to read.
// `examples` are source files the guide walks through; the command prints
// them after the guide, each under its path, so the guide never holds a copy
// of code that is typechecked and tested where it lives.
// The names are part of what prompts and the project's AGENTS.md say, so an
// existing one is not renamed.
export const GUIDES = {
  books: {
    file: "DBU6-BOOKS.md",
    title: "Working with the books through the HTTP API",
  },
  run: {
    file: "docs/run-guide.md",
    title:
      "Doing the books from a pile of statements in one session, up to adding them",
  },
  parsers: {
    file: "custom-built-parsers/README.md",
    title: "Statement parsers: conventions and the Abacus JSON contract",
  },
  "parser-guide": {
    file: "custom-built-parsers/import-statement-parser-guide.md",
    title: "Building a parser for a statement the importer cannot read",
  },
  "freeform-guide": {
    file: "custom-built-parsers/freeform-transactions-guide.md",
    title: "Importing freeform transactions as Abacus JSON",
  },
  reports: {
    file: "docs/reports-guide.md",
    title: "Writing a report: contract, route, screen, definition and test",
    examples: [
      "docs/examples/report/contract.ts",
      "docs/examples/report/api.ts",
      "docs/examples/report/api.test.ts",
      "docs/examples/report/Screen.tsx",
      "docs/examples/report/report.ts",
    ],
  },
  customizing: {
    file: "docs/customizing-guide.md",
    title:
      "Customizing dbu6: dbu6.config.ts (the categorizer seam, extra routes) and frontend.tsx (pages, navigation)",
    examples: [
      "docs/examples/customizing/dbu6.config.ts",
      "docs/examples/customizing/frontend.tsx",
    ],
  },
  "from-clone": {
    file: "docs/migrating-from-a-clone.md",
    title:
      "Moving books from a clone of the dbu6 repository into a project folder",
  },
} as const satisfies Record<
  string,
  { file: string; title: string; examples?: readonly string[] }
>;

export type GuideName = keyof typeof GUIDES;

// The run guide's sections a run can start at, by their `## ` headings, as a
// prompt names them (`runPrompt`'s `start`). A run from a pile of statements
// starts at the top and names none.
export const RUN_SECTIONS = [
  "Starting from the drafts",
  "Accounts with no statements",
] as const;

export type RunSection = (typeof RUN_SECTIONS)[number];

/** The command that prints a guide, as a prompt tells the agent to run it. */
export function guideCommand(name: GuideName): string {
  return `npx dbu6 docs ${name}`;
}

// The playbooks: one problem each, with its method, printed by
// `npx dbu6 docs playbook <name>` from `docs/playbooks/<name>.md`. A per-step
// prompt names its playbook through `playbookCommand` and keeps only what
// the screen knows (the case's facts, the outcome, the report's headings);
// the run guide sends the agent to the same files. They are a map of their
// own so the GUIDES names, which prompts and AGENTS.md already use, stay put,
// and `npx dbu6 docs` stays a short list. Like a guide's, a name is not
// renamed once a release has shipped it. Each file's first line is its
// title.
export const PLAYBOOKS = [
  "unrecognized-statement",
  "ambiguous-parsers",
  "unresolved-account",
  "identifier-required",
  "identifier-mismatch",
  "balance-mismatch",
  "boundary-gap",
  "statement-disagreement",
  "part-invalid",
  "reconciliation",
  "missing-ledger-account",
  "closing-balance",
  "categorize",
  "rule-requests",
  "duplicates",
  "balance-checks",
  "double-counted-transfers",
  "posted-balance-check",
  "chart-change",
  "off-statement-transaction",
] as const;

export type PlaybookName = (typeof PLAYBOOKS)[number];

/** A playbook's file, relative to the package directory. */
export function playbookFile(name: PlaybookName): string {
  return `docs/playbooks/${name}.md`;
}

/** The command that prints a playbook, as a prompt tells the agent to run it. */
export function playbookCommand(name: PlaybookName): string {
  return `npx dbu6 docs playbook ${name}`;
}
