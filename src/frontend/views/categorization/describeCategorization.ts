import {
  CODING_AGENTS,
  type CategorizationReport,
  type CategorizationTally,
} from "../../../shared/index";

// A run that found the coding agent can't be used: the Import statements
// result and Classify drafts say so in a dialog that sends the user to
// Settings, as nothing the screen offers can fix it.
export interface AgentUnavailable {
  // The report that said so; the dialog opens once per report.
  report: CategorizationReport;
  // "Claude Code isn't working"
  title: string;
  // The agent's own words, or dbu6's when it couldn't run the agent at all.
  reason: string;
}

/** The first of these reports whose agent couldn't be used, if any. */
export function agentUnavailable(
  reports: readonly (CategorizationReport | null)[],
): AgentUnavailable | null {
  const report = reports.find((one) => one?.failure === "agent_unavailable");
  if (!report) return null;
  return {
    report,
    title:
      report.agent === null
        ? "The coding agent isn't working"
        : `${CODING_AGENTS[report.agent].label} isn't working`,
    reason: report.error ?? "No reason was given.",
  };
}

// Why the LLM left some transactions uncategorized, because a call failed or
// couldn't run: said under the figures on the Import statements result and
// on Classify drafts, so "them" is the ones that need a category.
export interface CategorizationProblem {
  // "Claude Code couldn't categorize some of them"
  text: string;
  // The agent's own words for the first failure.
  reason: string;
}

export function describeCategorizationProblem(
  report: CategorizationReport,
): CategorizationProblem | null {
  const { failed_count: failed, sent_count: sent } = report;
  if (failed === 0) return null;
  const which = failed === sent ? "them" : "some of them";
  return {
    text:
      report.agent === null
        ? `Couldn't categorize ${which} automatically`
        : `${CODING_AGENTS[report.agent].label} couldn't categorize ${which}`,
    reason: report.error ?? "No reason was given.",
  };
}

// The transactions categorization saved, by whether they got a category.
// Who gave it, the rules or the LLM, stays in the tally: the user doesn't
// need it to get on with their books.
export interface CategorizationCounts {
  categorized: number;
  // Left without a category, whatever the reason.
  remaining: number;
}

export function categorizationCounts(
  tally: CategorizationTally,
): CategorizationCounts {
  return {
    categorized: tally.by_rule + tally.by_llm,
    remaining: tally.same_account + tally.uncategorized,
  };
}
