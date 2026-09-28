// The rule requests the user makes on Review's Improve categorization tab:
// drafts they picked, with each one's date, direction and amount, and the
// account those drafts go to, with a note for next time. They wait in the
// books as rule requests (categorization_rule_requests) until the user hands
// them to their coding agent, which proposes how each is encoded, a rule in
// transaction_mappings.mjs, a line of guidance, or both, or says why it
// shouldn't be; encodes what the user agrees to; and deletes it from the
// list. The drafts get their account when the user next runs the
// categorizer.

import {
  guideCommand,
  type CategorizationRuleRequest,
  type CategorizationRuleRequestTransaction,
  type ReviewAccountDetail,
} from "../../shared/index";
import { PII_RULE } from "../agent-prompt-rules";
import { agree, plural } from "../format";
import { reviewHref } from "./routes";

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
 * The request to the coding agent: each rule request as the user gave it,
 * amounts and all. The agent proposes first, and pushes back on a rule
 * request whose drafts share nothing the categorizer can see; how a rule
 * request is encoded is decided with the user, by the books guide.
 */
export function ruleRequestsPrompt(
  detail: ReviewAccountDetail,
  ruleRequests: readonly CategorizationRuleRequest[],
): string {
  const { account } = detail;
  const books = guideCommand("books");
  return `I'm adding categorization rules to my books app (this repository), on the
screen ${reviewHref(account.account_id, "improve-categorization")}. These are
drafts imported for ${account.name} (ledger account ${account.path}, account
id ${account.account_id}) that the categorizer couldn't place, grouped as I
picked them, and where I've said they go. Each draft is its date, which way
the money moved, the amount, and the description:

${ruleRequests.map((ruleRequest, index) => ruleRequestText(account.account_id, ruleRequest, index)).join("\n\n")}

The categorizer sees a transaction's description, which way the money
moved, and the amount, never its date. It tries, in order: exact rules in
user-config/transaction_mappings.mjs (a whole description, or a UPI ID
inside one); contains rules there (a phrase in the description, optionally
only one way and only within an amount range); then the AI, following the
instruction files this account's import preset lists. A rule applies to every
account; an instruction file applies to every account whose preset lists it.
\`${books}\` says how to choose, under "Always put this under X — adding a
mapping", and how to read this account's import preset. If this account lists
no instruction file, or only an empty one, tell me, and propose which to use.

Propose before you change anything. For each numbered rule request:

1. Say what these drafts have in common that the categorizer can see: a
   payee, a UPI ID, a merchant's name, a phrase. That I picked them together
   doesn't make them alike. If all they share is how they were paid (UPI,
   NEFT, IMPS, a card, an ATM), or nothing at all, say so plainly, propose no
   rule, and ask me what I meant. Drafts that only need filing once, I set by
   hand on the Drafts tab.
2. Propose the change: exact rule, contains rule or instruction, its exact
   text as it will read, and the file it goes in.
3. Limit it to an amount range when the amount is part of what makes these
   drafts alike, or when the phrase alone would catch other payments too.
   Take the range from the amounts I picked, rounded out to round figures
   (60 to 480 becomes 50 to 500), never the exact amounts, which change.
   Leave the range out when the payee alone settles it.
4. For a rule, check it against the transactions already in my books: how
   many it would have caught that are in a different account, with a few
   of them. Say whether that makes the rule wrong.

Then stop, and wait for me. Make only the changes I agree to.

Don't categorise the drafts yourself: once the rules are in, I run the
categoriser from the app.

When a rule request is encoded, delete it from my list with
\`npx sapporta api delete /api/categorization-rule-requests/<rule request id>\`, and do
the same for a rule request I tell you to drop. Leave any other rule request
on the list.

The rules and instruction files in user-config/ are my own settings: they
may name payees and amount ranges. Everywhere else: ${PII_RULE}

Report back what you did for each numbered rule request, or why you didn't.`;
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
