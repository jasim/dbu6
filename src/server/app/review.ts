import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  reviewContract,
  type ImportInstitution,
  type NamedAccount,
  type ReviewAccount,
  type ReviewAccountDetail,
  type ReviewAccounts,
} from "../../shared/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { accountLabel, accountNames } from "./account-names.js";
import { loadLedgerAccounts } from "../modules/accounts/index.js";
import {
  loadAccountStandings,
  type AccountStanding,
} from "./account-standing.js";
import {
  countDraftsByBaseAccount,
  countCategorizationRuleRequests,
  draftCounts,
  loadAccountsDraftsLandOn,
  type DraftAccountStatus,
} from "../modules/drafts/index.js";
import { loadOpeningBalances } from "../workflows/opening-balances.js";
import { loadOpeningEntries } from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { decidePress, reliesOnAlone } from "../workflows/posting.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * Review (PLAN.md §11 P3): the accounts with drafts, and for one account
 * what blocks adding its drafts to the books. Each account is projected from
 * its standing, whose draft status the posting gate reads too. One account's
 * review reads the standing of that account alone, and of the others only
 * their names and draft counts. Beside what blocks posting, each account
 * says how many rule requests wait for the coding agent, so Review's summary
 * and the agent's prompt count them. Whether an account's own Add goes in,
 * and which accounts Add all adds, are the posting gate's decisions, read
 * from it, so Review's ticks and the gate can't disagree.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("accounts", reviewContract.accounts, async ({ c }) => {
  const ledger = requireWorkflowLedger(c);
  const institutions = loadImportPresets(ledger.db, ledger.auth);
  return { status: 200, body: listReviewAccounts(ledger, institutions) };
});

api.register("account", reviewContract.account, async ({ c, request }) => {
  const ledger = requireWorkflowLedger(c);
  const detail = loadReviewAccount(
    ledger,
    loadImportPresets(ledger.db, ledger.auth),
    request.params.accountId,
  );
  if (detail === null) {
    return { status: 404, body: { error: "Account not found" } };
  }
  return { status: 200, body: detail };
});

export default api;

/**
 * Every account with drafts, sorted by display name, and the ones Add all,
 * a press of every one, would add.
 */
export function listReviewAccounts(
  ledger: Ledger,
  institutions: readonly ImportInstitution[],
): ReviewAccounts {
  const { db, sqlite, auth } = ledger;
  const names = accountNames(sqlite, auth, institutions);
  const ruleRequests = countCategorizationRuleRequests(db, auth);
  const withDrafts = Array.from(
    loadAccountStandings(sqlite, auth, institutions).values(),
  ).filter((standing) => standing.drafts !== undefined);
  const statuses = draftStatuses(withDrafts);
  const reliance = reliesOnAlone(sqlite, auth, statuses, names);
  const accounts = withDrafts
    .map((standing) =>
      reviewAccount(standing, reliance.get(standing.account_id), ruleRequests),
    )
    .sort(byName);
  const { adds } = decidePress(
    sqlite,
    auth,
    accounts.map((account) => account.account_id),
    statuses,
    names,
  );
  return { accounts, add_all: adds };
}

/**
 * The accounts the account's drafts land on that the opening-balances check
 * lists, so Review says so where the person categorizes to them.
 */
function noStartingBalance(ledger: Ledger, accountId: number) {
  const landOn = loadAccountsDraftsLandOn(
    ledger.sqlite,
    ledger.auth,
    accountId,
  );
  return loadOpeningBalances(ledger).unanswered.flatMap((account) =>
    landOn.has(account.accountId)
      ? [{ account_id: account.accountId, name: account.name }]
      : [],
  );
}

/** One account's review, or null when the account isn't in scope. */
export function loadReviewAccount(
  ledger: Ledger,
  institutions: readonly ImportInstitution[],
  accountId: number,
): ReviewAccountDetail | null {
  const { db, sqlite, auth } = ledger;
  const standing = loadAccountStandings(sqlite, auth, institutions, {
    accountId,
  }).get(accountId);
  if (!standing) return null;
  const { drafts } = standing;
  const reliance = reliesOnAlone(
    sqlite,
    auth,
    draftStatuses([standing]),
    accountNames(sqlite, auth, institutions),
  );

  return {
    account: reviewAccount(
      standing,
      reliance.get(accountId),
      countCategorizationRuleRequests(db, auth),
    ),
    checkpoint: standing.checkpoint,
    has_opening_entry: loadOpeningEntries(sqlite, auth, { accountId }).has(
      accountId,
    ),
    no_starting_balance: noStartingBalance(ledger, accountId),
    closing: drafts?.closing ?? null,
    failing: (drafts?.failing ?? []).map(
      ({ date, draft_id, running_balance, assertion, diff }) => ({
        date,
        draft_id,
        running_balance,
        assertion,
        diff,
      }),
    ),
    duplicates: (drafts?.duplicates ?? []).map((row) => ({
      date: row.date,
      draft_id: row.draft_id,
      other_draft_id: row.other_draft_id,
      matched_journal_id: row.matched_journal_id,
      matched_journal_entry_id: row.matched_journal_entry_id,
      match_kind: row.match_kind,
      match_type: row.match_type,
      confidence: row.confidence,
      direction: row.direction,
      amount: row.amount,
      narration: row.narration,
      other_narration: row.other_narration,
      draft_account: row.draft_account,
      matched_account: row.matched_account,
    })),
    other_accounts: otherAccountsWithDrafts(ledger, institutions, accountId),
  };
}

/** The accounts other than `accountId` with drafts, sorted by display name. */
function otherAccountsWithDrafts(
  { sqlite, auth }: Ledger,
  institutions: readonly ImportInstitution[],
  accountId: number,
): ReviewAccountDetail["other_accounts"] {
  const counts = countDraftsByBaseAccount(sqlite, auth);
  return loadLedgerAccounts(sqlite, auth)
    .filter((account) => account.id !== accountId && counts.has(account.id))
    .map((account) => ({
      account_id: account.id,
      name: accountLabel(account, institutions).name,
      drafts: counts.get(account.id)!,
    }))
    .sort(byName);
}

// `reliesOn` names the accounts its own Add would wait on; `ruleRequests`
// counts each account's rule requests.
function reviewAccount(
  standing: AccountStanding,
  reliesOn: NamedAccount[] | undefined,
  ruleRequests: ReadonlyMap<number, number>,
): ReviewAccount {
  return {
    account_id: standing.account_id,
    path: standing.path,
    parent_path: standing.parent_path,
    name: standing.name,
    kind: standing.kind,
    ...draftCounts(standing.drafts),
    relies_on: reliesOn ?? [],
    draft_span: standing.drafts?.draft_span ?? null,
    rule_requests: ruleRequests.get(standing.account_id) ?? 0,
  };
}

function byName(
  a: { name: string; account_id: number },
  b: { name: string; account_id: number },
): number {
  return a.name.localeCompare(b.name) || a.account_id - b.account_id;
}

// The draft status of each standing with drafts, by id.
function draftStatuses(
  standings: readonly AccountStanding[],
): Map<number, DraftAccountStatus> {
  return new Map(
    standings.flatMap((standing) =>
      standing.drafts ? [[standing.account_id, standing.drafts]] : [],
    ),
  );
}
