// The guides dbu6 ships for coding agents, by the name `dbu6 docs <name>`
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
} as const satisfies Record<
  string,
  { file: string; title: string; examples?: readonly string[] }
>;

export type GuideName = keyof typeof GUIDES;

/** The command that prints a guide, as a prompt tells the agent to run it. */
export function guideCommand(name: GuideName): string {
  return `dbu6 docs ${name}`;
}
