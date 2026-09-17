import {
  CATEGORIZATION_ENGINE_LABEL,
  type CategorizationReport,
} from "dbu6-shared";

// Descriptions the LLM got no answer for, because a call failed or couldn't
// run: said on the Import statements result and on Classify drafts. Those
// transactions stay uncategorized.
export interface CategorizationProblem {
  // "Couldn't categorize 3 of 12 descriptions with Claude Code"
  text: string;
  // The engine's own words for the first failure.
  reason: string;
}

export function describeCategorizationProblem(
  report: CategorizationReport,
): CategorizationProblem | null {
  const { failed_count: failed, sent_count: sent } = report;
  if (failed === 0) return null;
  const engine = CATEGORIZATION_ENGINE_LABEL[report.engine];
  const which =
    sent === 1
      ? "the 1 description"
      : failed === sent
        ? `any of the ${sent} descriptions`
        : `${failed} of ${sent} descriptions`;
  return {
    text: `Couldn't categorize ${which} with ${engine}`,
    reason: report.error ?? "No reason was given.",
  };
}
