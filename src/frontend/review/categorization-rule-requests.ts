// The rule requests the user makes on Review's Improve categorization tab:
// drafts they picked, with each one's date, direction and amount, and the
// account those drafts go to, with a note for next time. They wait in the
// books as rule requests (categorization_rule_requests) until the user hands
// them to their coding agent, which proposes how each is encoded, a rule in
// transaction_mappings.mjs for its account's statement, a line of guidance,
// or both, or says why it shouldn't be; encodes what the user agrees to; and deletes it from the
// list. The drafts get their account when the user next runs the
// categorizer.

import {
  type CategorizationRuleRequest,
  type CategorizationRuleRequestTransaction,
  type ReviewAccountDetail,
} from "../../shared/index";
import { agentPrompt, type AgentPrompt } from "../agent-prompt-rules";
import { agree, plural } from "../format";
import { IMPROVE_CATEGORIZATION_TAB, reviewHref } from "./routes";

/** Drafts listed under a rule request before the rest are only counted. */
export const RULE_REQUEST_TRANSACTION_LIMIT = 20;

type Direction = CategorizationRuleRequestTransaction["direction"];

/** The amounts a rule request's drafts moved one way: how many, the least, the most. */
export interface AmountsSeen {
  direction: Direction;
  count: number;
  min: number;
  max: number;
}

/** A rule request's amounts, money out first, then money in; a way none moved is left out. */
export function amountsSeen(
  transactions: readonly CategorizationRuleRequestTransaction[],
): AmountsSeen[] {
  return (["withdrawal", "deposit"] as const).flatMap((direction) => {
    const amounts = transactions
      .filter((transaction) => transaction.direction === direction)
      .map((transaction) => transaction.amount);
    return amounts.length === 0
      ? []
      : [
          {
            direction,
            count: amounts.length,
            min: Math.min(...amounts),
            max: Math.max(...amounts),
          },
        ];
  });
}

/**
 * The rule requests, as the user made them, handed to the coding agent to
 * encode, as the rule-requests playbook says.
 */
export function ruleRequestsPrompt(
  detail: ReviewAccountDetail,
  ruleRequests: readonly CategorizationRuleRequest[],
): AgentPrompt {
  const { account } = detail;
  return agentPrompt({
    outcome: `Turn my ${plural(ruleRequests.length, "rule request")} for ${account.name} into categorization rules, so the categorizer places drafts like these.`,
    facts: `${accountLine(detail)}
Screen: ${reviewHref(account.account_id, IMPROVE_CATEGORIZATION_TAB)}

Rule requests (date · out or in, amount · description):
${ruleRequests.map((ruleRequest, index) => ruleRequestText(account.account_id, ruleRequest, index)).join("\n\n")}`,
    playbook: "rule-requests",
    how: USER_RUNS_CATEGORIZER,
    next: "Run categorizer, on Review.",
  });
}

/**
 * What a prompt asking for rules adds to its playbook: from Review, the user
 * runs the categorizer, so the agent leaves it alone.
 */
export const USER_RUNS_CATEGORIZER =
  "Don't run the categorizer: I run it from the app.";

/** The account line both categorization prompts open their facts with. */
export function accountLine(detail: ReviewAccountDetail): string {
  const { account } = detail;
  return `Account: ${account.name} (${account.path}, account id ${account.account_id})`;
}

function ruleRequestText(
  accountId: number,
  ruleRequest: CategorizationRuleRequest,
  index: number,
): string {
  const { transactions } = ruleRequest;
  const shown = transactions.slice(0, RULE_REQUEST_TRANSACTION_LIMIT);
  const rest = transactions.length - shown.length;
  return [
    `${index + 1}. ${plural(transactions.length, "draft")} ${agree(transactions.length, "goes", "go")} to "${ruleRequest.account.name}" (rule request id ${ruleRequest.id}), ${amountsSeen(transactions).map(amountsText).join("; ")}:`,
    ...shown.map(
      (transaction) =>
        `   - ${transaction.date} · ${way(transaction.direction)} ${amount(transaction.amount)} · ${transaction.source_narration}`,
    ),
    ...(rest > 0
      ? [
          `   - and ${rest} more: \`npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":${accountId}}'\``,
        ]
      : []),
    ...(ruleRequest.note === "" ? [] : [`   My note: ${ruleRequest.note}`]),
  ].join("\n");
}

function amountsText(seen: AmountsSeen): string {
  const range =
    seen.min === seen.max
      ? amount(seen.min)
      : `${amount(seen.min)} to ${amount(seen.max)}`;
  return `money ${way(seen.direction)} ${range}`;
}

function way(direction: Direction): string {
  return direction === "withdrawal" ? "out" : "in";
}

function amount(value: number): string {
  return value.toFixed(2);
}
