// The prompt behind Create a report: the user says what they want to see, and
// their coding agent writes the report into the project's reports/ folder.
// The reports guide says where it goes, what it may import, how to test it
// and how to see it; the prompt carries only the user's words and the ids
// already taken.
import { guideCommand } from "../../shared/index";
import { agentPrompt, type AgentPrompt } from "../agent-prompt-rules";

/** `wanted` is the user's own description of the report, as they typed it. */
export function createReportPrompt(
  wanted: string,
  takenIds: readonly string[],
): AgentPrompt {
  return agentPrompt({
    outcome:
      "Add a report to my books, under Reports, that shows what I describe below.",
    facts: `What it should show, in my words:
"""
${wanted.trim()}
"""

Report ids already taken: ${takenIds.join(", ")}`,
    how: `Write it as \`${guideCommand("reports")}\` says. If my words leave open which
accounts, period or columns I mean, ask me first.`,
    report: [
      {
        heading: "Where to find it",
        says: "what to restart, and where it is under Reports.",
      },
      {
        heading: "Figures to check",
        says: "two or three it shows from my books that I can check against what I know.",
      },
      { heading: "Check", says: "whether `npx dbu6 check` passes." },
    ],
  });
}
