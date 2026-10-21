// Every prompt the app hands the user's coding agent is an AgentTask, written
// out by agentPrompt in one shape: the outcome first, then the case's facts,
// then only what the agent can't learn from the project (its AGENTS.md and
// `npx dbu6 docs books` already say how to reach the app, how a balance check
// works, and to ask before changing the books), and last the two replies the
// user reads: the plan, and the report.
//
// The agent echoes what it is given. A prompt that opens with backstory gets
// a plan that retells it, and a prompt with no shape for the report gets an
// essay. So the outcome is one sentence we write, which the plan restates,
// and each task names what its report holds, in the order the user needs it.
import { guideCommand } from "../shared/index";

export interface AgentTask {
  /**
   * What the user gets when the agent is done, in one sentence, in the
   * app's words: "Get HDFC Bank's 3 failing balance checks to pass, so its
   * drafts can be added to the books."
   */
  outcome: string;
  /** What the app saw: the case's numbers, ids, files and messages. */
  facts: string;
  /** How to go about it, only where the guides don't already say. */
  how?: string;
  /** The final reply's sections, in the order the user reads them. */
  report: readonly ReportSection[];
}

/**
 * One section of the agent's final reply. The heading is shown to the user,
 * so what's under it has to read on its own, not as the answer to a question
 * only the prompt asked.
 */
export interface ReportSection {
  /** "What's wrong", "The fix", "Next". */
  heading: string;
  /** What goes under it: "why the running balance misses the statement's". */
  says: string;
}

/** A prompt as the agent gets it; only agentPrompt makes one. */
export type AgentPrompt = string & { readonly __agentPrompt: true };

// Nothing an agent does should start on its own: a prompt opens a session
// that runs in the agent's auto mode, so the user first sees what the work
// is for and says go.
export const PLAN_FIRST_RULE = `Your first reply is three short lines, under 50 words in all: the outcome in
your own words; how you'll get there, in one sentence; "Go ahead?". Don't
read files, run commands or call the app until I say go. If the work later
needs something this didn't say, stop and ask me.`;

const REPORT_RULE = `When you're done, reply under these bold headings, in this order, with a line
or two under each that reads on its own, without this prompt beside it: say
the thing itself, never "Yes" to a heading, and don't number them. Use the app's words, not the
data's ("Talking to the user" in \`${guideCommand("books")}\`). Leave out how
you worked it out, and any heading with nothing under it.`;

export function agentPrompt(task: AgentTask): AgentPrompt {
  const report = task.report
    .map(({ heading, says }) => `**${heading}**: ${says}`)
    .join("\n");
  return [
    `Outcome: ${task.outcome}`,
    task.facts,
    task.how,
    PLAN_FIRST_RULE,
    `${REPORT_RULE}\n${report}`,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join("\n\n") as AgentPrompt;
}

// What the agent may not put in the repository, for prompts that have it
// write a fixture or test. The parsers guide has the conventions.
export const PII_RULE = `No real names, account numbers, references or amounts in any file you write:
use the 050505 / NOPII / sample conventions in \`${guideCommand("parsers")}\`.`;
