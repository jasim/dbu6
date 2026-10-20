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
import { PII_RULE } from "../agent-prompt-rules";
import { plural } from "../format";
import { categorizerFacts } from "./categorization-rule-requests";
import { IMPROVE_CATEGORIZATION_TAB, reviewHref } from "./routes";

/** How many questions the agent puts to the user at a time. */
export const QUESTIONS_AT_A_TIME = 5;

export function categorizeWithAgentPrompt(
  detail: ReviewAccountDetail,
  ruleRequests: readonly CategorizationRuleRequest[],
): string {
  const { account } = detail;
  const id = account.account_id;
  const waiting =
    ruleRequests.length === 0
      ? ""
      : `

I've already said where some of them go: ${plural(ruleRequests.length, "rule request")}
I made on the screen, each with its drafts, the account and sometimes a note.
Read them with
\`npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":${id}}'\`.
Take their accounts as my answers, and don't ask me about those drafts again.
When one is encoded, delete it with
\`npx sapporta api delete /api/categorization-rule-requests/<rule request id>\`.`;
  return `Help me categorize the drafts in my books app (this repository) that the
categorizer couldn't place, by talking it through with me. They are the
${plural(account.uncategorised, "draft")} imported for ${account.name} (ledger account
${account.path}, account id ${id}) that have no account, on the screen
${reviewHref(id, IMPROVE_CATEGORIZATION_TAB)}.

Read them with
\`npx sapporta rows list draft_transactions --where '{"base_account_id":{"eq":${id}},"account_id":{"is":"null"}}' --sort source_narration --limit 1000\`,
and my accounts with \`npx sapporta rows list accounts --limit 1000\`. To
see where similar transactions went before, read the ones already in my
books.${waiting}

${categorizerFacts()}

How to go about it:

1. Group the drafts by what the categorizer can see that they share: a
   payee, a UPI ID, a merchant's name, a phrase. How they were paid (UPI,
   NEFT, IMPS, a card, an ATM) is not something they share.
2. For each group, work out the account it most likely goes to, from the
   description, the amounts, and where transactions like it already sit in
   my books, and the rule or instruction that would place it: exact rule,
   contains rule or instruction, its exact text, and the file it goes in.
   Limit a rule to an amount range only when the phrase alone would catch
   other payments too, rounded out to round figures (60 to 480 becomes 50
   to 500). Check each rule against the transactions already in my books:
   how many it would have caught that are in a different account.
3. Show me the groups you're confident about together, one line each: the
   descriptions (a few, and how many), the account, and the rule. I'll say
   yes to all, or name the ones to change.
4. Then ask me about the rest, at most ${QUESTIONS_AT_A_TIME} at a time. For each, show
   a few of its descriptions with dates and amounts, and offer two to four
   accounts from my chart of accounts as numbered options, most likely
   first, plus "something else" and "skip". Say in a few words why you
   think each might fit. If no account fits, I may want a new one: propose
   its name and parent, and add it only when I say so.
5. A draft that shares nothing with any other, and so makes no rule, gets
   its account set directly once I've picked it:
   \`npx sapporta api post /api/draft-transactions/set-account --body '{"ids":[…],"account_id":<account>}'\`.

Make only the changes I agree to. Don't run the categorizer yourself: once
the rules are in, I run it from the app, which places the drafts they cover.

The rules and instruction files in user-config/ are my own settings: they
may name payees and amount ranges. Everywhere else: ${PII_RULE}

When we're done, report how many drafts each new rule or instruction
covers, how many you set directly, and what's left without an account.`;
}
