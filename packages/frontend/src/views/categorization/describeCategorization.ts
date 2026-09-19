import {
  CODING_AGENTS,
  type CategorizationReport,
  type CategorizationTally,
  type CodingAgent,
} from "dbu6-shared";
import { agree } from "../../format";

// Descriptions the LLM got no answer for, because a call failed or couldn't
// run: said on the Import statements result and on Classify drafts. Those
// transactions stay uncategorized.
export interface CategorizationProblem {
  // "Couldn't categorize 3 of 12 descriptions with Claude Code"
  text: string;
  // The agent's own words for the first failure.
  reason: string;
}

export function describeCategorizationProblem(
  report: CategorizationReport,
): CategorizationProblem | null {
  const { failed_count: failed, sent_count: sent } = report;
  if (failed === 0) return null;
  const which =
    sent === 1
      ? "the 1 description"
      : failed === sent
        ? `any of the ${sent} descriptions`
        : `${failed} of ${sent} descriptions`;
  return {
    text:
      report.agent === null
        ? `Couldn't categorize ${which}`
        : `Couldn't categorize ${which} with ${CODING_AGENTS[report.agent].label}`,
    reason: report.error ?? "No reason was given.",
  };
}

// What categorization did with the transactions it saved, said after an
// import and on Classify drafts.
export interface CategorizationSummary {
  // "Categorized 12 (9 by your rules, 3 by Claude Code)."
  text: string;
  // "4 remain": the ones left without an account, linked to where they are
  // categorized. Null when none are.
  remain: string | null;
  // Why some of those were left, when the answer was the statement's own
  // account; null when none were.
  sameAccount: string | null;
}

// `agent` is the one the report names: who "by the LLM" was.
export function describeCategorizationTally(
  tally: CategorizationTally,
  agent: CodingAgent | null,
): CategorizationSummary | null {
  const categorized = tally.by_rule + tally.by_llm;
  const remaining = tally.same_account + tally.uncategorized;
  if (categorized + remaining === 0) return null;
  const llm = agent === null ? "the LLM" : CODING_AGENTS[agent].label;
  const sources = [
    { count: tally.by_rule, by: "by your rules" },
    { count: tally.by_llm, by: `by ${llm}` },
  ].filter((source) => source.count > 0);
  const text =
    sources.length === 0
      ? "Categorized none."
      : sources.length === 1
        ? `Categorized ${categorized} ${sources[0].by}.`
        : `Categorized ${categorized} (${sources
            .map((source) => `${source.count} ${source.by}`)
            .join(", ")}).`;
  const skipped = tally.same_account;
  return {
    text,
    remain:
      remaining === 0
        ? null
        : `${remaining} ${agree(remaining, "remains", "remain")}`,
    sameAccount:
      skipped === 0
        ? null
        : `${skipped} of them ${agree(skipped, "was", "were")} matched to the statement's own account, which can't be the other side of ${agree(skipped, "its", "their")} entry.`,
  };
}
