// The parts of a coding-agent prompt about parsers and the import presets,
// the same wherever the app asks for one: /import when it can't read a file,
// and /add's Teach card. Each screen writes its own task around them. How a
// parser is written, where it goes and how a bundled one is changed are in
// the parser guides; how the presets change is in the books guide.
import { guideCommand } from "../shared/index";
import { PII_RULE, type ReportSection } from "./agent-prompt-rules";

const PARSERS_GUIDE = guideCommand("parsers");
const PARSER_GUIDE = guideCommand("parser-guide");
const BOOKS_GUIDE = guideCommand("books");

/** Where a prompt sends the agent to change the import presets. */
export const PRESETS_SECTION = `"Import presets" in \`${BOOKS_GUIDE}\``;

/** How a parser is written, for a prompt that has the agent write one. */
export const WRITE_PARSER = `Write the parser as \`${PARSER_GUIDE}\` and \`${PARSERS_GUIDE}\` say.
${PII_RULE}`;

/** How a parser is fixed, for a prompt where the parser may be the cause. */
export const FIX_PARSER = `Fix a parser with a sanitized fixture and test, never by loosening validation.
${PII_RULE}`;

/** Which saved parsers turned a file down, as a fact line. */
export function triedParsers(candidateParserPaths: readonly string[]): string {
  return candidateParserPaths.length === 0
    ? "Parsers tried: none for this file type"
    : `Parsers that rejected it: ${candidateParserPaths.join(", ")}`;
}

/** Two parsers claim one file: how to part them. */
export const PART_PARSERS = `Tighten their fingerprints (\`${PARSERS_GUIDE}\`) so each rejects the other's
layout at its first structural check, with a parser_test.py case in each that
rejects the other's fixture. Keep every fixture passing; loosen no validation.`;

/** What the agent reports once a parser reads the file. */
export const NEW_PARSER_REPORT: ReportSection = {
  heading: "The parser",
  says: "what the statement is, and what the parser reads from it: date range, row count, opening and closing balance.",
};

/** What the agent reports once only one parser reads the file. */
export const PARTED_PARSERS_REPORT: ReportSection = {
  heading: "Which parser reads it",
  says: "the parser that now reads the file, and what tells the two layouts apart.",
};
