// Prompts the user copies into their coding agent from Review's Duplicates
// and Balance checks tabs (PLAN.md §11 P3), in the manner of the import
// prompts: what the app was doing, the facts, what to do, what not to do,
// and what to report back.

import type {
  ReviewAccountDetail,
  ReviewDuplicate,
  ReviewFailingCheck,
} from "dbu6-shared";
import { PII_RULE } from "../agent-prompt-rules";
import { plural } from "../format";
import { duplicatesText, failingChecksText } from "./posting-checks";
import { reviewHref } from "./routes";

/** Rows listed in a prompt before the rest are left to the API. */
export const PROMPT_ROW_LIMIT = 50;

export function duplicatesPrompt(detail: ReviewAccountDetail): string {
  const { account } = detail;
  return `I'm reviewing drafts in my books app (this repository) before adding them to
the books, on the screen ${reviewHref(account.account_id, "duplicates")}. It flags
${duplicatesText(detail.duplicates.length)} in the drafts for ${account.name}, and it
won't add those drafts to the books while any are left.

${accountFacts(detail)}

${readingTheData(account.account_id)}

Each possible duplicate, one per line: the date, the direction and amount, the
draft (id, narration, category), what it matched, and how it matched.

${rows(detail.duplicates, duplicateLine)}

For each line, find out whether the two are one real transaction or two. If
they are one, say which draft is the extra one. If they are two real
transactions, find out why
packages/api/modules/transaction-identity/journal-transaction-matcher.ts matched them.
A draft is compared only with other drafts on this account and with
transactions in the books that have an entry on this account. So a match is
usually two drafts for the same transaction; a draft for a statement row
that's already in the books; or a draft that looks like a transaction in the
books that doesn't say which statement row it came from (one I entered by
hand, or an older import), with the same date, amount and category. A transfer
already added from my other account's statement usually isn't flagged here; it
shows up as a failing balance check instead.

${GROUND_RULES}

Report back a verdict for each line (one transaction or two, and why) and the
change you propose for it.`;
}

export function balanceChecksPrompt(detail: ReviewAccountDetail): string {
  const { account, failing } = detail;
  return `I'm reviewing drafts in my books app (this repository) before adding them to
the books, on the screen ${reviewHref(account.account_id, "balance-checks")}.
${failingChecksText(failing.length)} in the drafts for ${account.name}: on those days
the drafts' running balance doesn't reach the balance the statement printed,
and the app won't add the drafts to the books until every check passes.

${accountFacts(detail)}

${readingTheData(account.account_id)}

Each failing check, one per line: the date, the draft id, the running balance,
the statement's balance, and the difference (running minus statement).

${rows(failing, failingLine)}

How the check is computed (the rule is in
packages/api/modules/reconciliation/balance-check.ts, the query in
running-balance.ts next to it): the running balance adds up every posted entry
on the account, including entries posted from other accounts, and then the
drafts. On the same date, posted entries come before drafts, and drafts go in
id order. Only the last draft of each day carries the statement's balance,
and the check passes when the two are less than half a paisa apart.

Please find the first failing day, list the account's posted entries and
drafts around it with the running balance after each, and find what explains
the difference: a draft repeating an entry already posted from another
account (a card payment or a transfer), a missing or extra draft, an amount or
date edited after import, or a gap between statements.

${GROUND_RULES}

Report back the cause and the exact fix: which drafts or entries to delete,
add or change, by id.`;
}

const GROUND_RULES = `Don't change drafts, journals or balance checks without first telling me exactly
what you would change and why. ${PII_RULE}`;

function accountFacts(detail: ReviewAccountDetail): string {
  const { account, checkpoint } = detail;
  const dates = account.draft_span
    ? ` dated ${account.draft_span.first_date} to ${account.draft_span.last_date}`
    : "";
  const checked =
    checkpoint === null
      ? "It has no posted balance check yet."
      : `Its last posted balance check is ${amount(checkpoint.balance)} on ${checkpoint.date}.`;
  return `The account is ${account.name}: ledger account ${account.path}, account id
${account.account_id}. It has ${plural(account.drafts, "draft")}${dates} waiting in Review. ${checked}`;
}

function readingTheData(accountId: number): string {
  const api = "$SAPPORTA_API_URL/api";
  return `To read the data, with the dev server running, send an agent access token
(I can create one from my account page in the app) as
"Authorization: Bearer $SAPPORTA_API_TOKEN" to:

  GET ${api}/review/accounts/${accountId}
  GET ${api}/reports/duplicate-drafts?base_account_id=${accountId}
  GET ${api}/reports/draft-balance-assertions?base_account_id=${accountId}
  GET ${api}/tables/draft_transactions?filter[base_account_id][eq]=${accountId}&sort=date,id&limit=1000
  GET ${api}/reports/account-ledger?account_id=${accountId}&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD

The first says what blocks these drafts; the last lists the posted entries on
the account with their running balance. Or open data/sqlite.db read-only.`;
}

function rows<T>(items: readonly T[], line: (item: T) => string): string {
  const shown = items.slice(0, PROMPT_ROW_LIMIT).map(line);
  const rest = items.length - shown.length;
  return [
    ...shown,
    ...(rest > 0 ? [`and ${rest} more (read them from the API above)`] : []),
  ].join("\n");
}

function duplicateLine(row: ReviewDuplicate): string {
  const matched =
    row.other_draft_id !== null
      ? `draft ${row.other_draft_id} "${row.other_narration ?? ""}"`
      : `journal ${row.matched_journal_id}, entry ${row.matched_journal_entry_id} "${row.other_narration ?? ""}" (${row.matched_category ?? "no account"})`;
  return `- ${row.date} · ${row.direction} ${amount(row.amount)} · draft ${row.draft_id} "${row.narration}" (${row.draft_category ?? "no category"}) · matched ${matched} · ${row.match_type}, confidence ${Math.round(row.confidence * 100)}%`;
}

function failingLine(row: ReviewFailingCheck): string {
  return `- ${row.date} · draft ${row.draft_id} · running ${amount(row.running_balance)} · statement ${amount(row.assertion)} · difference ${amount(row.diff)}`;
}

function amount(value: number): string {
  return value.toFixed(2);
}
