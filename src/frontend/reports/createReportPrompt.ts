// The prompt behind Create a report: the user says what they want to see, and
// their coding agent writes the report into the project's reports/ folder.
// Like every prompt the app hands over, it reaches the agent with the
// plan-first rule on top (the AgentPrompt panel puts it there).
import { guideCommand } from "../../shared/index";
import { PII_RULE, PROJECT_FILES_RULE } from "../agent-prompt-rules";

const REPORTS_GUIDE = guideCommand("reports");
const BOOKS_GUIDE = guideCommand("books");

/** `wanted` is the user's own description of the report, as they typed it. */
export function createReportPrompt(
  wanted: string,
  takenIds: readonly string[],
): string {
  return `I want a new report in my books app (dbu6, run from this project). What it
should show, in my words:

"""
${wanted.trim()}
"""

If that leaves open which accounts, which period or which columns I mean, ask
me before you build anything.

Run \`${REPORTS_GUIDE}\` and follow the guide it prints, which ends with one
complete worked report to write yours after. \`${BOOKS_GUIDE}\` describes the
ledger's tables. ${PROJECT_FILES_RULE}

1. Give the report a short id in kebab-case and make the folder
   reports/<id>/ in this project, with the four files the guide names:
   contract.ts, api.ts, Screen.tsx and report.ts. These ids are taken:
   ${takenIds.join(", ")}.
2. Import only from "dbu6/server" and "dbu6/frontend". Read the books only
   through \`reportLedger\`, which is read-only and holds only my rows; a report
   never changes the ledger.
3. Put the figures in a function that takes the ledger and the query, and
   test it with node:test against \`openTestLedger()\`, as the guide's example
   does. ${PII_RULE}
4. Run \`dbu6 check\` and fix what it reports about the report.
5. Tell me how to open it (restart \`dbu6 dev\` or \`dbu6 start\` so the new route
   is mounted, then Reports, under "Your reports"), and give me two or three
   figures from my real books that I can check against what I know.`;
}
