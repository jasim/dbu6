import {
  CODING_AGENTS,
  type CategorizationReport,
  type CategorizationTally,
} from "dbu6-shared";

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
