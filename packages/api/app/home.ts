import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  homeContract,
  type HomeAccount,
  type HomeSummary,
  type ImportPreset,
} from "dbu6-shared";
import { readImportPresets } from "../bank-importer/import-presets.js";
import {
  duplicateDraftRowsSql,
  duplicateJournalEntryRowsSql,
  findDuplicateDiagnostics,
  type DuplicateDraftSourceRow,
  type DuplicateJournalEntrySourceRow,
} from "../modules/reconciliation/duplicate-diagnostics.js";
import {
  baseAccountRunningBalanceCtes,
  failingDraftAssertionsSelect,
} from "../modules/reconciliation/running-balance.js";
import { loadLastReconciled } from "./reports/last-reconciled.js";
import { allRows, ledgerCtes, type ScopeParams } from "./reports/shared.js";
import { requireWorkflowAuth, requireWorkflowScope } from "./workflow-auth.js";

/*
 * The Home screen's one request (PLAN.md §11 P1): the importable accounts
 * with where their books stand, and what waits in the drafts. It composes
 * the queries the checkpoint, draft balance assertion and duplicate drafts
 * reports already run, so Home and those reports cannot disagree.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("summary", homeContract.summary, async ({ c }) => {
  requireWorkflowAuth(c);
  const scope = requireWorkflowScope(c);
  const presets = await readImportPresets();
  return {
    status: 200,
    body: loadHomeSummary(c.get("sqlite"), scope, presets),
  };
});

export default api;

/** An account at least one preset imports into, with its display name. */
export interface ImportableAccount {
  path: string;
  name: string;
  kind: HomeAccount["kind"];
}

/**
 * The unique base accounts across the presets, in first-seen order. An
 * account named by one preset takes that preset's name; one shared by
 * several (two parsers for one bank) falls back to its own last segment.
 * It is a card when any preset importing into it says so.
 */
export function importableAccounts(
  presets: readonly ImportPreset[],
): ImportableAccount[] {
  const byPath = new Map<string, { names: Set<string>; card: boolean }>();
  for (const preset of presets) {
    const entry = byPath.get(preset.base_account) ?? {
      names: new Set<string>(),
      card: false,
    };
    entry.names.add(preset.name);
    entry.card = entry.card || preset.is_credit_card === true;
    byPath.set(preset.base_account, entry);
  }
  return Array.from(byPath, ([path, { names, card }]) => ({
    path,
    name: names.size === 1 ? Array.from(names)[0] : readableSegment(path),
    kind: card ? "card" : "bank",
  }));
}

function readableSegment(path: string): string {
  const last = path.split(":").filter(Boolean).at(-1) ?? path;
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type DraftCountRow = {
  account_id: number;
  drafts: number;
  uncategorised: number;
};

type CountRow = { account_id: number; n: number };

export function loadHomeSummary(
  sqlite: Database.Database,
  scope: ScopeParams,
  presets: readonly ImportPreset[],
): HomeSummary {
  const ledgerIds = new Map(
    allRows<{ id: number; name: string }>(
      sqlite,
      `${ledgerCtes} SELECT id, name FROM scoped_accounts`,
      scope,
    ).map((row) => [row.name, row.id]),
  );
  const checkpoints = new Map(
    loadLastReconciled(sqlite, scope).map((row) => [row.account_id, row]),
  );
  const draftCounts = allRows<DraftCountRow>(
    sqlite,
    `${ledgerCtes}
    SELECT
      base_account_id AS account_id,
      COUNT(*) AS drafts,
      SUM(CASE WHEN account_id IS NULL THEN 1 ELSE 0 END) AS uncategorised
    FROM scoped_draft_transactions
    WHERE base_account_id IS NOT NULL
    GROUP BY base_account_id`,
    scope,
  );
  const failing = allRows<CountRow>(
    sqlite,
    `${ledgerCtes}${baseAccountRunningBalanceCtes}
    SELECT account_id, COUNT(*) AS n
    FROM (${failingDraftAssertionsSelect}) r
    GROUP BY account_id`,
    scope,
  );
  const duplicates = countDuplicates(sqlite, scope);
  const journalAccounts = new Set(
    allRows<{ account_id: number }>(
      sqlite,
      `${ledgerCtes} SELECT DISTINCT account_id FROM scoped_journal_entries`,
      scope,
    ).map((row) => row.account_id),
  );

  const draftsById = new Map(draftCounts.map((row) => [row.account_id, row]));
  const failingById = new Map(failing.map((row) => [row.account_id, row.n]));

  const accounts: HomeAccount[] = importableAccounts(presets)
    .map((account) => {
      const id = ledgerIds.get(account.path) ?? null;
      const checkpoint = id === null ? undefined : checkpoints.get(id);
      const drafts = id === null ? undefined : draftsById.get(id);
      return {
        account_id: id,
        path: account.path,
        name: account.name,
        kind: account.kind,
        checked_to: checkpoint?.last_reconciled_date ?? null,
        checked_balance: checkpoint?.last_balance ?? null,
        drafts: drafts?.drafts ?? 0,
        uncategorised: drafts?.uncategorised ?? 0,
        duplicates: id === null ? 0 : (duplicates.get(id) ?? 0),
        failing_checks: id === null ? 0 : (failingById.get(id) ?? 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    accounts,
    totals: {
      drafts: sum(draftCounts.map((row) => row.drafts)),
      uncategorised: sum(draftCounts.map((row) => row.uncategorised)),
      duplicates: sum(Array.from(duplicates.values())),
      failing_checks: sum(failing.map((row) => row.n)),
    },
    has_journals: accounts.some(
      (account) =>
        account.account_id !== null && journalAccounts.has(account.account_id),
    ),
  };
}

/** Possible duplicates per base account, counted as the report lists them. */
function countDuplicates(
  sqlite: Database.Database,
  scope: ScopeParams,
): Map<number, number> {
  const drafts = allRows<DuplicateDraftSourceRow>(
    sqlite,
    `${ledgerCtes}${duplicateDraftRowsSql}`,
    scope,
  );
  const journalEntries = allRows<DuplicateJournalEntrySourceRow>(
    sqlite,
    `${ledgerCtes}${duplicateJournalEntryRowsSql}`,
    scope,
  );
  const counts = new Map<number, number>();
  for (const row of findDuplicateDiagnostics(drafts, journalEntries)) {
    counts.set(row.base_account_id, (counts.get(row.base_account_id) ?? 0) + 1);
  }
  return counts;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
