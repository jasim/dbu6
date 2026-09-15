import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  reviewContract,
  type ImportPreset,
  type ReviewAccount,
  type ReviewAccountDetail,
} from "dbu6-shared";
import { readImportPresets } from "../bank-importer/import-presets.js";
import {
  loadAccountStandings,
  type AccountStanding,
} from "./account-standing.js";
import { draftCounts } from "./draft-status.js";
import type { ScopeParams } from "./reports/shared.js";
import { requireWorkflowAuth, requireWorkflowScope } from "./workflow-auth.js";

/*
 * Review (PLAN.md §11 P3): the accounts with drafts, and for one account
 * what blocks adding its drafts to the books. Each account is projected from
 * its standing, whose draft status the posting gate reads too.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("accounts", reviewContract.accounts, async ({ c }) => {
  requireWorkflowAuth(c);
  const scope = requireWorkflowScope(c);
  const presets = await readImportPresets();
  return {
    status: 200,
    body: { accounts: listReviewAccounts(c.get("sqlite"), scope, presets) },
  };
});

api.register("account", reviewContract.account, async ({ c, request }) => {
  requireWorkflowAuth(c);
  const scope = requireWorkflowScope(c);
  const presets = await readImportPresets();
  const detail = loadReviewAccount(
    c.get("sqlite"),
    scope,
    presets,
    request.params.accountId,
  );
  if (detail === null) {
    return { status: 404, body: { error: "Account not found" } };
  }
  return { status: 200, body: detail };
});

export default api;

/** Every account with drafts, sorted by display name. */
export function listReviewAccounts(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
): ReviewAccount[] {
  return accountsWithDrafts(loadAccountStandings(sqlite, scope, presets));
}

/** One account's review, or null when the account isn't in scope. */
export function loadReviewAccount(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
  accountId: number,
): ReviewAccountDetail | null {
  const standings = loadAccountStandings(sqlite, scope, presets);
  const standing = standings.get(accountId);
  if (!standing) return null;
  const { drafts } = standing;

  return {
    account: reviewAccount(standing),
    checkpoint: standing.checkpoint,
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
      draft_category: row.draft_category,
      matched_category: row.matched_category,
    })),
    other_accounts: accountsWithDrafts(standings)
      .filter((other) => other.account_id !== accountId)
      .map(({ account_id, name, drafts }) => ({ account_id, name, drafts })),
  };
}

function accountsWithDrafts(
  standings: ReadonlyMap<number, AccountStanding>,
): ReviewAccount[] {
  return Array.from(standings.values())
    .filter((standing) => standing.drafts !== undefined)
    .map(reviewAccount)
    .sort(byName);
}

function reviewAccount(standing: AccountStanding): ReviewAccount {
  return {
    account_id: standing.account_id,
    path: standing.path,
    name: standing.name,
    kind: standing.kind,
    ...draftCounts(standing.drafts),
    draft_span: standing.drafts?.draft_span ?? null,
  };
}

function byName(a: ReviewAccount, b: ReviewAccount): number {
  return a.name.localeCompare(b.name) || a.account_id - b.account_id;
}
