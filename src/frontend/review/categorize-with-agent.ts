// Improve categorization's other way: rather than the user picking drafts
// that go together and saying where, the coding agent reads every draft the
// categorizer couldn't place, finds what they have in common, and talks the
// user through it. What it is sure of it proposes in a batch; what it isn't,
// it asks, offering a few accounts to pick from. What the user agrees to
// becomes rules or guidance, as a rule request would; a one-off with nothing
// to make a rule from gets its account set directly.

import type {
  CategorizationRuleRequest,
  ReviewAccountDetail,
} from "../../shared/index";
import { agentPrompt, type AgentPrompt } from "../agent-prompt-rules";
import { plural } from "../format";
import {
  accountLine,
  DELETE_ENCODED,
  RULE_FACTS,
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
    outcome: `Settle with me where ${account.name}'s ${plural(account.uncategorised, "uncategorized draft")} go, and add rules so the categorizer places ones like them next time.`,
    facts: [
      accountLine(detail),
      `Screen: ${reviewHref(id, IMPROVE_CATEGORIZATION_TAB)}`,
      `Drafts with no account: ${account.uncategorised}
\`npx sapporta rows list draft_transactions --where '{"base_account_id":{"eq":${id}},"account_id":{"is":"null"}}' --sort source_narration --limit 1000\``,
      ...requests,
    ].join("\n"),
    how: [
      RULE_FACTS,
      `Group the drafts by what they share, and find each group's likely account
(from where ones like it sit in my books) and its rule. Then:
- Show every group you're sure of in one list, a line each: a few
  descriptions and how many, the account, the rule. I'll say yes or name
  the ones to change.
- Ask about the rest, at most ${QUESTIONS_AT_A_TIME} at a time: a few descriptions with
  dates and amounts, and 2–4 of my accounts as numbered options, likeliest
  first, plus "something else" and "skip". If none fits, propose a new
  account's name and parent.
- A draft like no other gets its account set directly, no rule.`,
      ...(ruleRequests.length === 0 ? [] : [DELETE_ENCODED]),
    ].join("\n\n"),
    report: [
      {
        heading: "New rules",
        says: "each rule or instruction line, and how many drafts it covers.",
      },
      { heading: "Set by hand", says: "how many drafts you set directly." },
      { heading: "Still without an account", says: "how many drafts." },
      { heading: "Next", says: "Run categorizer, on Review." },
    ],
  });
}
