import {
  agentPrompt,
  type AgentPrompt,
  type ReportSection,
} from "../agent-prompt-rules";
import {
  NEW_PARSER_REPORT,
  PART_PARSERS,
  PARTED_PARSERS_REPORT,
  PRESETS_SECTION,
  triedParsers,
  WRITE_PARSER,
} from "../parser-prompts";
import type { Unreadable } from "./state";

/*
 * The Teach card's tasks, for a file no parser reads or several do. /add
 * sets the account up itself, at its Confirm card, once the parser reads
 * the files, so the agent lists the parser on the bank and never adds an
 * account. The read keeps a copy of each file inside the project for these.
 */

type UnreadableFile<Status extends Unreadable["status"]> = Extract<
  Unreadable,
  { status: Status }
>;

const REDROP_REPORT: ReportSection = {
  heading: "Next",
  says: "drop the files at /add again.",
};

export function addUnrecognizedPrompt(
  file: UnreadableFile<"unrecognized">,
): AgentPrompt {
  return agentPrompt({
    outcome: `Add a bank account or card from ${file.file_name}, a statement format no saved parser recognises, by writing a parser for it.`,
    facts: `File: ${file.saved_path}
${triedParsers(file.candidate_parser_paths)}`,
    how: `${WRITE_PARSER}
Then list it on the bank's institution in the import presets
(${PRESETS_SECTION}): add_parser to the institution that covers this bank,
or add_institution. Never add an account: /add sets it up from the
statements. Ask me the bank when the file doesn't say.`,
    report: [
      NEW_PARSER_REPORT,
      { heading: "Import presets", says: "what changed in them." },
      REDROP_REPORT,
    ],
  });
}

export function addAmbiguousPrompt(
  file: UnreadableFile<"ambiguous">,
): AgentPrompt {
  return agentPrompt({
    outcome: `Add a bank account or card from ${file.file_name}, which more than one saved parser recognises, by making only one of them read it.`,
    facts: `File: ${file.saved_path}
Parsers that read it: ${file.matching_parser_paths.join(", ")}`,
    how: PART_PARSERS,
    report: [
      PARTED_PARSERS_REPORT,
      { heading: "The fix", says: "what changed in each parser." },
      REDROP_REPORT,
    ],
  });
}
