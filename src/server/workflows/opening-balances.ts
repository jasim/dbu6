import { Temporal } from "@sapporta/shared/temporal";
import {
  createOpeningBalancesAccount,
  findOpeningBalancesAccount,
  loadHledgerAccountNames,
  loadLedgerAccounts,
  type NamedAccount,
} from "../modules/accounts/index.js";
import { loadFirstDrafts } from "../modules/drafts/index.js";
import type { JournalPlan } from "../modules/journal-plan/index.js";
import {
  insertJournalPlan,
  loadFirstEntryDates,
  loadOpeningEntries,
  type OpeningEntry,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";

/*
 * Opening balances: what each asset and liability account held or owed
 * before its first transaction. Recording one posts the account's opening
 * entry, a journal with the account's line, which carries the amount as its
 * balance assertion, and the opposite line on Opening Balances (Equity). An
 * account has one opening entry (`loadOpeningEntries`); this never changes
 * or adds a second.
 *
 * Amounts are signed like a balance assertion: positive when held, negative
 * when owed.
 */

export type OpeningAccountType = "Asset" | "Liability";

/** What an opening journal is called when the user says nothing more. */
export const OPENING_DESCRIPTION = "Opening balance";

export interface OpeningBalanceAccount {
  accountId: number;
  name: string;
  path: string;
  accountType: OpeningAccountType;
  /** The account's first posted entry or draft; null with neither. */
  firstActivityDate: string | null;
  /** The day before it: the date an opening entry defaults to. */
  defaultDate: string | null;
  /**
   * The opening balance the first balance check implies, when the account
   * has drafts, nothing posted, and a draft carrying a statement balance.
   */
  suggestedAmount: number | null;
  opening: OpeningEntry | null;
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
  const paths = loadHledgerAccountNames(db, auth);
  const openings = loadOpeningEntries(sqlite, auth);
  const firstEntries = loadFirstEntryDates(sqlite, auth);
  const firstDrafts = loadFirstDrafts(sqlite, auth);
  const equity = findOpeningBalancesAccount(db, auth);

  const accounts = loadLedgerAccounts(sqlite, auth)
    .filter(
      (
        account,
      ): account is typeof account & { account_type: OpeningAccountType } =>
        account.account_type === "Asset" ||
        account.account_type === "Liability",
    )
    .map((account): OpeningBalanceAccount => {
      const firstEntry = firstEntries.get(account.id) ?? null;
      const drafts = firstDrafts.get(account.id) ?? null;
      const opening = openings.get(account.id) ?? null;
      const firstActivityDate = earlier(firstEntry, drafts?.first_date ?? null);
      return {
        accountId: account.id,
        name: account.name,
        path: paths.get(account.name) ?? account.name,
        accountType: account.account_type,
        firstActivityDate,
        defaultDate: firstActivityDate && dayBefore(firstActivityDate),
        suggestedAmount:
          opening === null && firstEntry === null
            ? (drafts?.implied_opening ?? null)
            : null,
        opening,
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
