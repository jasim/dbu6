import {
  fingerprintTightening,
  parserWritingSteps,
  PRESET_CHANGES_NOTE,
  triedParsers,
} from "../parser-prompts";
import type { Unreadable } from "./state";

/*
 * The Teach card's prompts, for a file no parser reads or several do. /add
 * sets the account up itself, at its Confirm card, once the parser reads
 * the files, so the agent lists the parser on the bank and never adds an
 * account. The read keeps a copy of each file inside the project for these.
 */

type UnreadableFile<Status extends Unreadable["status"]> = Extract<
  Unreadable,
  { status: Status }
>;

export function addUnrecognizedPrompt(
  file: UnreadableFile<"unrecognized">,
): string {
  return `I dropped a bank statement into my books app (dbu6, run from this project) at
/add, to add a bank account or card from its statements. It said no saved
parser recognised the file, so nothing was added. Please build a deterministic
parser for this statement format.

The file is in this project at ${file.saved_path}.
Ask me which bank it is if the file doesn't make that obvious. ${triedParsers(file.candidate_parser_paths)}

${parserWritingSteps()}
6. List the parser on the bank's institution in the import presets, as
   below. If an institution there already covers this bank, add the parser to
   it by its directory name (add_parser); otherwise add the institution with
   the parser (add_institution). Don't add an account: dbu6 sets it up when I
   add the statements at /add.
7. Run the parser on that file and on the fixture, run the tests, and report
   the opening balance, closing balance, date range, and row count you found so
   I can check them against the statement.

${PRESET_CHANGES_NOTE}

When you are done, tell me. I'll drop the files at /add again.`;
}

export function addAmbiguousPrompt(file: UnreadableFile<"ambiguous">): string {
  return `I dropped bank statements into my books app (dbu6, run from this project) at
/add, to add a bank account or card from them. It reported that
${file.file_name} matched more than one saved parser:
${file.matching_parser_paths.join(", ")}. Auto-detection requires exactly one match,
so nothing was added.

${fingerprintTightening(file.saved_path)}

Tell me when it is done. I'll drop the files at /add again.`;
}
