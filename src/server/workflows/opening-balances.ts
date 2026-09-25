import { Temporal } from "@sapporta/shared/temporal";
import type { OpeningLock, OpeningSection } from "../../shared/index.js";
import {
  createOpeningBalancesAccount,
  findOpeningBalancesAccount,
  loadAccountChart,
  loadHledgerAccountNames,
  loadLedgerAccounts,
  type NamedAccount,
} from "../modules/accounts/index.js";
import {
  loadFirstCategorizedDraftDates,
  loadFirstDrafts,
} from "../modules/drafts/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import type { JournalPlan } from "../modules/journal-plan/index.js";
import {
  deleteOpeningEntry,
  insertJournalPlan,
  loadEntriesBesideOpening,
  loadOpeningEntries,
  rewriteOpeningEntry,
  type OpeningEntry,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";

/*
 * Opening balances: what each asset and liability account held or owed
 * before its first transaction. Recording one posts the account's opening
 * entry, a journal with the account's line, which carries the amount as its
 * balance assertion, and the opposite line on Opening Balances (Equity). An
 * account has one opening entry (`loadOpeningEntries`); recording never adds
 * a second.
 *
 * Settings › Opening balances changes or removes an opening entry while it
 * is the only posted entry on its account and opens that account alone.
 * Once anything else is posted on the account, or when its journal opens
 * other accounts too, the entry is locked and the user changes the journal
 * by hand. Drafts are not posted, so they never lock it.
 *
 * Amounts are signed like a balance assertion: positive when held, negative
 * when owed.
 */

export type OpeningAccountType = "Asset" | "Liability";

/** What an opening journal is called when the user says nothing more. */
export const OPENING_DESCRIPTION = "Opening balance";

/** An account's opening entry, and why it can't be changed in place. */
export type OpeningBalance = OpeningEntry & {
  /** Null while it can be changed or removed. */
  locked: OpeningLock | null;
};

export interface OpeningBalanceAccount {
  accountId: number;
  name: string;
  path: string;
  accountType: OpeningAccountType;
  /**
   * Where the Opening balances page lists it: a bank or card an import
   * preset lists, else what the user owns or owes (C1's). Null for an
   * account with accounts under it and no opening entry, which is left out.
   */
  section: OpeningSection | null;
  /**
   * The account's first posted entry outside its opening entry, or its first
   * draft, from its own statements or categorized to it; null with neither.
   */
  firstActivityDate: string | null;
  /**
   * The date an opening entry defaults to: the day before its first
   * activity, else the day the books start (their earliest opening entry),
   * else null.
   */
  defaultDate: string | null;
  /**
   * The opening balance the first balance check implies, when the account
   * has drafts, nothing posted but its opening entry, and a draft carrying a
   * statement balance.
   */
  suggestedAmount: number | null;
  opening: OpeningBalance | null;
}

export interface OpeningBalances {
  /** Null until the first opening entry creates it. */
  equityAccount: NamedAccount | null;
  accounts: OpeningBalanceAccount[];
}

/** Every asset and liability account and its opening entry, by path. */
export function loadOpeningBalances({
  db,
  sqlite,
  auth,
}: Ledger): OpeningBalances {
  const chart = loadAccountChart(db, auth);
  const paths = loadHledgerAccountNames(db, auth);
  const openings = loadOpeningEntries(sqlite, auth);
  const besideOpening = loadEntriesBesideOpening(sqlite, auth);
  const firstDrafts = loadFirstDrafts(sqlite, auth);
  const firstCategorized = loadFirstCategorizedDraftDates(sqlite, auth);
  const equity = findOpeningBalancesAccount(db, auth);
  const parents = new Set(chart.map((account) => account.parent_id));
  const statementAccounts = new Set(
    loadImportPresets(db, auth).flatMap((institution) =>
      institution.accounts.map((account) => account.account_id),
    ),
  );
  const booksStart = [...openings.values()].reduce<string | null>(
    (first, opening) => earlier(first, opening.date),
    null,
  );

  const accounts = chart
    .filter(
      (
        account,
      ): account is typeof account & { account_type: OpeningAccountType } =>
        account.account_type === "Asset" ||
        account.account_type === "Liability",
    )
    .map((account): OpeningBalanceAccount => {
      const beside = besideOpening.get(account.id) ?? null;
      const drafts = firstDrafts.get(account.id) ?? null;
      const opening = openings.get(account.id) ?? null;
      const firstActivityDate = [
        beside?.first_date ?? null,
        drafts?.first_date ?? null,
        firstCategorized.get(account.id) ?? null,
      ].reduce<string | null>(earlier, null);
      return {
        accountId: account.id,
        name: account.name,
        path: paths.get(account.name) ?? account.name,
        accountType: account.account_type,
        section: sectionOf(account.account_type, {
          fromStatements: statementAccounts.has(account.id),
          leaf: !parents.has(account.id),
          opened: opening !== null,
        }),
        firstActivityDate,
        defaultDate: firstActivityDate
          ? dayBefore(firstActivityDate)
          : booksStart,
        suggestedAmount:
          beside === null ? (drafts?.implied_opening ?? null) : null,
        opening: opening && {
          ...opening,
          locked: lockOf(opening, beside?.entries ?? 0),
        },
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    equityAccount:
      equity && equity.account_type === "Equity"
        ? { id: equity.id, name: equity.name }
        : null,
    accounts,
  };
}

/*
 * A bank or card goes with its statements, whatever its type. Any other
 * account is listed when the user gives it a balance: a leaf, or a group
 * account that already has one.
 */
function sectionOf(
  type: OpeningAccountType,
  account: { fromStatements: boolean; leaf: boolean; opened: boolean },
): OpeningSection | null {
  if (account.fromStatements) return "statement";
  if (!account.leaf && !account.opened) return null;
  return type === "Asset" ? "own" : "owe";
}

/*
 * One posted entry beside the opening entry locks it, since changing it would
 * move balances the books already carry forward. A journal that opens more
 * than this account is the user's to change by hand.
 */
function lockOf(
  opening: OpeningEntry,
  entriesBeside: number,
): OpeningLock | null {
  if (entriesBeside > 0) return "has_entries";
  if (!opening.standalone) return "shared_entry";
  return null;
}

export interface OpeningBalanceRequest {
  accountId: number;
  /** An ISO date, before the account's first posted entry or draft. */
  date: string;
  amount: number;
  /** What the user says it came from; the journal's description. */
  description?: string;
}

export type OpeningBalanceOutcome =
  | { kind: "account-not-found" }
  | { kind: "not-asset-or-liability"; accountName: string }
  | { kind: "already-recorded"; accountName: string; opening: OpeningEntry }
  | {
      kind: "date-not-before-first-activity";
      accountName: string;
      firstActivityDate: string;
    }
  // An account named Opening Balances exists, but not as Equity.
  | { kind: "opening-balances-not-equity" }
  | {
      kind: "recorded";
      accountName: string;
      journalId: number;
      equityAccount: NamedAccount;
      equityAccountCreated: boolean;
    };

/**
 * Posts one account's opening entry, creating Opening Balances on the first.
 * Refuses an account that isn't an asset or a liability, one that already has
 * an opening entry, and a date on or after the account's first activity,
 * where the entry would land in the middle of its history.
 */
export function recordOpeningBalance(
  ledger: Ledger,
  request: OpeningBalanceRequest,
): OpeningBalanceOutcome {
  const { db, auth } = ledger;
  // better-sqlite3 runs the transaction synchronously on the one connection,
  // so what it reads is what it writes against.
  return db.transaction((tx: any): OpeningBalanceOutcome => {
    const ledgerAccount = loadLedgerAccounts(ledger.sqlite, auth).find(
      (candidate) => candidate.id === request.accountId,
    );
    if (ledgerAccount === undefined) return { kind: "account-not-found" };
    const account = loadOpeningBalances(ledger).accounts.find(
      (candidate) => candidate.accountId === request.accountId,
    );
    if (account === undefined) {
      return {
        kind: "not-asset-or-liability",
        accountName: ledgerAccount.name,
      };
    }
    if (account.opening !== null) {
      return {
        kind: "already-recorded",
        accountName: account.name,
        opening: account.opening,
      };
    }
    if (
      account.firstActivityDate !== null &&
      Temporal.PlainDate.compare(request.date, account.firstActivityDate) >= 0
    ) {
      return {
        kind: "date-not-before-first-activity",
        accountName: account.name,
        firstActivityDate: account.firstActivityDate,
      };
    }

    const existing = findOpeningBalancesAccount(tx, auth);
    if (existing !== null && existing.account_type !== "Equity") {
      return { kind: "opening-balances-not-equity" };
    }
    const equityAccount = existing ?? createOpeningBalancesAccount(tx, auth);

    const [journalId] = insertJournalPlan(
      tx,
      openingPlan(account.accountId, equityAccount.id, request),
      auth,
    ).journalIds;
    return {
      kind: "recorded",
      accountName: account.name,
      journalId,
      equityAccount: { id: equityAccount.id, name: equityAccount.name },
      equityAccountCreated: existing === null,
    };
  });
}

// Why an existing opening entry can't be changed or removed.
type OpeningEditRefusal =
  | { kind: "account-not-found" }
  | { kind: "not-asset-or-liability"; accountName: string }
  | { kind: "not-recorded"; accountName: string }
  | {
      kind: "locked";
      accountName: string;
      lock: OpeningLock;
      journalId: number;
    };

export type OpeningChangeOutcome =
  | OpeningEditRefusal
  | {
      kind: "date-not-before-first-activity";
      accountName: string;
      firstActivityDate: string;
    }
  | { kind: "changed"; accountName: string; journalId: number };

export type OpeningRemovalOutcome =
  | OpeningEditRefusal
  | { kind: "removed"; accountName: string; journalId: number };

/**
 * Changes an account's opening entry in place: its date, amount and
 * description. Refuses what `editableOpening` refuses, and a date on or after
 * the account's first activity.
 */
export function changeOpeningBalance(
  ledger: Ledger,
  request: OpeningBalanceRequest,
): OpeningChangeOutcome {
  return ledger.db.transaction((tx: any): OpeningChangeOutcome => {
    const found = editableOpening(ledger, request.accountId);
    if (found.kind !== "editable") return found;
    const { account, opening } = found;
    if (
      account.firstActivityDate !== null &&
      Temporal.PlainDate.compare(request.date, account.firstActivityDate) >= 0
    ) {
      return {
        kind: "date-not-before-first-activity",
        accountName: account.name,
        firstActivityDate: account.firstActivityDate,
      };
    }
    rewriteOpeningEntry(tx, ledger.auth, opening, {
      date: request.date,
      amount: request.amount,
      description: request.description?.trim() || OPENING_DESCRIPTION,
    });
    return {
      kind: "changed",
      accountName: account.name,
      journalId: opening.journal_id,
    };
  });
}

/**
 * Deletes an account's opening entry. Refuses what `editableOpening`
 * refuses. Opening Balances stays, for the next one.
 */
export function removeOpeningBalance(
  ledger: Ledger,
  accountId: number,
): OpeningRemovalOutcome {
  return ledger.db.transaction((tx: any): OpeningRemovalOutcome => {
    const found = editableOpening(ledger, accountId);
    if (found.kind !== "editable") return found;
    deleteOpeningEntry(tx, ledger.auth, found.opening);
    return {
      kind: "removed",
      accountName: found.account.name,
      journalId: found.opening.journal_id,
    };
  });
}

/*
 * The account's opening entry, when it may be changed in place: the
 * account is in the books, is an asset or a liability, has an opening entry,
 * and nothing locks it. Read inside the caller's transaction.
 */
function editableOpening(
  ledger: Ledger,
  accountId: number,
):
  | OpeningEditRefusal
  | {
      kind: "editable";
      account: OpeningBalanceAccount;
      opening: OpeningBalance;
    } {
  const ledgerAccount = loadLedgerAccounts(ledger.sqlite, ledger.auth).find(
    (candidate) => candidate.id === accountId,
  );
  if (ledgerAccount === undefined) return { kind: "account-not-found" };
  const account = loadOpeningBalances(ledger).accounts.find(
    (candidate) => candidate.accountId === accountId,
  );
  if (account === undefined) {
    return { kind: "not-asset-or-liability", accountName: ledgerAccount.name };
  }
  const { opening } = account;
  if (opening === null) {
    return { kind: "not-recorded", accountName: account.name };
  }
  if (opening.locked !== null) {
    return {
      kind: "locked",
      accountName: account.name,
      lock: opening.locked,
      journalId: opening.journal_id,
    };
  }
  return { kind: "editable", account, opening };
}

/** The opening entry: the account's line and its assertion, against Equity. */
function openingPlan(
  accountId: number,
  equityAccountId: number,
  { date, amount, description }: OpeningBalanceRequest,
): JournalPlan<number> {
  const line = {
    comment: "Opening balance",
    sourceReference: null,
    sourceTransactionKey: null,
  };
  return [
    {
      date,
      description: description?.trim() || OPENING_DESCRIPTION,
      entries: [
        { ...line, account: accountId, amount, assertion: amount },
        { ...line, account: equityAccountId, amount: -amount, assertion: null },
      ],
    },
  ];
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function dayBefore(date: string): string {
  return Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
}
