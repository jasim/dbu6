import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  reviewContract,
  type ImportPreset,
  type ReviewAccount,
  type ReviewAccountDetail,
} from "dbu6-shared";
import { readImportPresets } from "../bank-importer/import-presets.js";
import { accountLabel } from "./account-names.js";
import { loadDraftStatus, type DraftAccountStatus } from "./draft-status.js";
import { loadLastReconciled } from "./reports/last-reconciled.js";
import { allRows, ledgerCtes, type ScopeParams } from "./reports/shared.js";
import { requireWorkflowAuth, requireWorkflowScope } from "./workflow-auth.js";

/*
 * Review (PLAN.md §11 P3): the accounts with drafts, and for one account
 * what blocks adding its drafts to the books. The blocks are the draft
 * status module's, which the posting gate reads too.
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

type LedgerAccount = { id: number; name: string; account_type: string | null };

/** Every account with drafts, sorted by display name. */
export function listReviewAccounts(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
): ReviewAccount[] {
  return pendingAccounts(
    loadLedgerAccounts(sqlite, scope),
    loadDraftStatus(sqlite, scope),
    presets,
  );
}

/** One account's review, or null when the account isn't in scope. */
export function loadReviewAccount(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
  accountId: number,
): ReviewAccountDetail | null {
  const ledger = loadLedgerAccounts(sqlite, scope);
  const account = ledger.get(accountId);
  if (!account) return null;

  const statuses = loadDraftStatus(sqlite, scope);
  const status = statuses.get(accountId);
  const checkpoint = loadLastReconciled(sqlite, scope).find(
    (row) => row.account_id === accountId,
  );

  return {
    account: reviewAccount(account, status, presets),
    checked_to: checkpoint?.last_reconciled_date ?? null,
    checked_balance: checkpoint?.last_balance ?? null,
    balance_checks: status?.balance_checks ?? 0,
    closing: status?.closing ?? null,
    failing: (status?.failing ?? []).map(
      ({ date, draft_id, running_balance, assertion, diff }) => ({
        date,
        draft_id,
        running_balance,
        assertion,
        diff,
      }),
    ),
    duplicates: (status?.duplicates ?? []).map((row) => ({
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
    other_accounts: pendingAccounts(ledger, statuses, presets)
      .filter((other) => other.account_id !== accountId)
      .map(({ account_id, name, drafts }) => ({ account_id, name, drafts })),
  };
}

function loadLedgerAccounts(
  sqlite: Database.Database,
  scope: ScopeParams,
): Map<number, LedgerAccount> {
  return new Map(
    allRows<LedgerAccount>(
      sqlite,
      `${ledgerCtes} SELECT id, name, account_type FROM scoped_accounts`,
      scope,
    ).map((row) => [row.id, row]),
  );
}

function pendingAccounts(
  ledger: ReadonlyMap<number, LedgerAccount>,
  statuses: ReadonlyMap<number, DraftAccountStatus>,
  presets: readonly ImportPreset[],
): ReviewAccount[] {
  return Array.from(statuses.values())
    .flatMap((status) => {
      const account = ledger.get(status.account_id);
      return account ? [reviewAccount(account, status, presets)] : [];
    })
    .sort(byName);
}

function reviewAccount(
  account: LedgerAccount,
  status: DraftAccountStatus | undefined,
  presets: readonly ImportPreset[],
): ReviewAccount {
  return {
    account_id: account.id,
    path: account.name,
    ...accountLabel(account.name, account.account_type, presets),
    drafts: status?.drafts ?? 0,
    uncategorised: status?.uncategorised ?? 0,
    duplicates: status?.duplicates.length ?? 0,
    failing_checks: status?.failing.length ?? 0,
    first_date: status?.first_date ?? null,
    last_date: status?.last_date ?? null,
  };
}

function byName(a: ReviewAccount, b: ReviewAccount): number {
  return a.name.localeCompare(b.name) || a.account_id - b.account_id;
}
