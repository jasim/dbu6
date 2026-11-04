// Improve categorization's other way: rather than the user picking drafts
// that go together and saying where, the coding agent reads every draft the
// categorizer couldn't place, finds what they have in common, and talks the
// user through it. What it is sure of it proposes in a batch; what it isn't,
// it asks, offering a few accounts to pick from. The drafts get their
// accounts set directly; a rule or guidance line for next time is proposed
// on its own and written only on the user's yes to it.

import type {
  CategorizationRuleRequest,
  ReviewAccountDetail,
} from "../../shared/index";
import { agentPrompt, type AgentPrompt } from "../agent-prompt-rules";
import { plural } from "../format";
import {
  accountLine,
  USER_RUNS_CATEGORIZER,
} from "./categorization-rule-requests";
import { IMPROVE_CATEGORIZATION_TAB, reviewHref } from "./routes";

/** How many questions the agent puts to the user at a time. */
export const QUESTIONS_AT_A_TIME = 5;

export function categorizeWithAgentPrompt(
  detail: ReviewAccountDetail,
  ruleRequests: readonly CategorizationRuleRequest[],
): AgentPrompt {
  const { account } = detail;
  const id = account.account_id;
  const requests =
    ruleRequests.length === 0
      ? []
      : [
          `Rule requests I've made: ${ruleRequests.length}, their accounts are my answers for those drafts:
\`npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":${id}}'\``,
        ];
  return agentPrompt({
    outcome: `Settle with me where ${account.name}'s ${plural(account.uncategorised, "uncategorized draft")} go, and add the rules I agree to, so the categorizer places ones like them next time.`,
    facts: [
      accountLine(detail),
      `Screen: ${reviewHref(id, IMPROVE_CATEGORIZATION_TAB)}`,
      `Drafts with no account: ${account.uncategorised}
\`npx sapporta rows list draft_transactions --where '{"base_account_id":{"eq":${id}},"account_id":{"is":"null"}}' --sort source_narration --limit 1000\``,
      ...requests,
    ].join("\n"),
    playbook: "categorize",
    how: `Ask about the groups you're not sure of at most ${QUESTIONS_AT_A_TIME} at a time.
${USER_RUNS_CATEGORIZER}`,
    next: "Run categorizer, on Review, for any you skipped.",
  });
}
