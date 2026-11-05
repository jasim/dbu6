import { Temporal } from "@sapporta/shared/temporal";
import type {
  OpeningLock,
  OpeningSection,
  OpeningSource,
} from "../../shared/index.js";
import {
  createOpeningBalancesAccount,
  findOpeningBalancesAccount,
  loadAccountChart,
  loadHledgerAccountNames,
  loadLedgerAccounts,
  type NamedAccount,
} from "../modules/accounts/index.js";
import { BANK_CARD_LOAN_GROUPS } from "../modules/chart-of-accounts/index.js";
import {
  loadFirstCategorizedDraftDates,
  loadFirstDrafts,
} from "../modules/drafts/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import type { JournalPlan } from "../modules/journal-plan/index.js";
import {
  cents,
  deleteOpeningEntry,
  insertJournalPlan,
  loadEntriesBesideOpening,
  loadOpeningEntries,
  rewriteOpeningEntry,
  type OpeningEntry,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  loadBalancesWithDrafts,
  loadImpliedOpenings,
  loadMovementThrough,
} from "../modules/reconciliation/index.js";
import { sameAmount } from "../modules/values/index.js";

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
 *
 * How each account starts is recorded once, as its opening entry: an amount
 * carried in, or 0 dated the day before its first event when it started
 * inside the books ("started here": a loan paid out on 12 Mar owed 0 on
 * 11 Mar). An account nobody has answered for has no opening entry, and
 * `unanswered` lists it: the one rule the screens, the agent, `dbu6 check`
 * and the run's report read. An account the user never held is deleted
 * instead, through the Accounts page's delete, which refuses one anything
 * is on; then there is nothing to answer.
 *
 * A balance the user knows on a later day is recorded as it is said: the
 * workflow takes the account's movement up to and including that day from
 * the running balance (`loadMovementThrough`) and posts what is left as the
 * opening, dated the day before its first activity.
 */

export type OpeningAccountType = "Asset" | "Liability";

/** What an opening journal is called when the user says nothing more. */
export const OPENING_DESCRIPTION = "Opening balance";

/**
 * An account's opening entry, why it can't be changed in place, and where it
 * came from: its statements while it is the opening their first balance
 * check implies, else entered by hand.
 */
export type OpeningBalance = OpeningEntry & {
  /** Null while it can be changed or removed. */
  locked: OpeningLock | null;
  source: OpeningSource;
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
  /** `loadImpliedOpenings`' figure; null with no balance check. */
  impliedOpening: number | null;
  opening: OpeningBalance | null;
}

/** An account whose balance sits on the wrong side for its type. */
export interface WrongSideBalance {
  account: OpeningBalanceAccount;
  /** Posted entries plus drafts, signed like `opening.amount`. */
  balance: number;
}

export interface OpeningBalances {
  /** Null until the first opening entry creates it. */
  equityAccount: NamedAccount | null;
  accounts: OpeningBalanceAccount[];
  /**
   * The check: every leaf asset or liability account with no opening entry,
   * by path, whether or not anything is on it. Left out are a group with
   * accounts under it, which takes no opening, and `emptyGroups`.
   */
  unanswered: OpeningBalanceAccount[];
  /**
   * The groups banks, cards and loans are added under
   * (`BANK_CARD_LOAN_GROUPS`) while nothing is on them and nothing is under
   * them: a leaf the check leaves out, since nothing in the books says
   * whether it waits for accounts or is one. Once anything is on it, it is
   * on `unanswered` like any other account.
   */
  emptyGroups: OpeningBalanceAccount[];
  /**
   * Accounts whose balance, drafts included, sits on the wrong side for
   * their type: an asset in credit, a liability in debit. Some are ordinary
   * (a card paid in excess, an overdrawn account), so it is worth a look,
   * never an error.
   */
  wrongSide: WrongSideBalance[];
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
  const impliedOpenings = loadImpliedOpenings(sqlite, auth);
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
      const impliedOpening = impliedOpenings.get(account.id) ?? null;
      const leaf = !parents.has(account.id);
      const fromStatements = statementAccounts.has(account.id);
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
          fromStatements,
          leaf,
          opened: opening !== null,
        }),
        firstActivityDate,
        defaultDate: firstActivityDate
          ? dayBefore(firstActivityDate)
          : booksStart,
        impliedOpening,
        opening: opening && {
          ...opening,
          locked: lockOf(opening, beside?.entries ?? 0),
          source:
            impliedOpening !== null &&
            sameAmount(opening.amount, impliedOpening)
              ? "statement"
              : "manual",
        },
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const balances = loadBalancesWithDrafts(sqlite, auth);
  const unopenedLeaves = accounts.filter(
    (account) => account.opening === null && !parents.has(account.accountId),
  );
  const emptyGroup = (account: OpeningBalanceAccount) =>
    account.firstActivityDate === null &&
    BANK_CARD_LOAN_GROUPS.includes(account.name);
  return {
    equityAccount:
      equity && equity.account_type === "Equity"
        ? { id: equity.id, name: equity.name }
        : null,
    accounts,
    unanswered: unopenedLeaves.filter((account) => !emptyGroup(account)),
    emptyGroups: unopenedLeaves.filter(emptyGroup),
    wrongSide: accounts.flatMap((account) => {
      const balance = balances.get(account.accountId) ?? 0;
      return onWrongSide(account.accountType, balance)
        ? [{ account, balance }]
        : [];
    }),
  };
}

// An asset in credit, or a liability in debit, by more than rounding.
function onWrongSide(type: OpeningAccountType, balance: number): boolean {
  if (sameAmount(balance, 0)) return false;
  return type === "Asset" ? balance < 0 : balance > 0;
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
  /**
   * An ISO date. Changing an opening takes one before the account's first
   * posted entry or draft; recording one also takes a later day, a balance
   * known then (`recordOpeningBalance`).
   */
  date: string;
  /** The balance at the end of `date`, signed like an assertion. */
  amount: number;
  /** What the user says it came from; the journal's description. */
  description?: string;
}

export type OpeningBalanceOutcome =
  | { kind: "account-not-found" }
  | { kind: "not-asset-or-liability"; accountName: string }
  | { kind: "already-recorded"; accountName: string; opening: OpeningEntry }
  // An account named Opening Balances exists, but not as Equity.
  | { kind: "opening-balances-not-equity" }
  | {
      kind: "recorded";
      accountName: string;
      journalId: number;
      /** The opening as posted: the request's, or worked back to it. */
      date: string;
      amount: number;
      equityAccount: NamedAccount;
      equityAccountCreated: boolean;
    };

/**
 * Posts one account's opening entry, creating Opening Balances on the first.
 * Refuses an account that isn't an asset or a liability, and one that
 * already has an opening entry. The request's amount is the balance at the
 * end of its date: before the account's first activity it is the opening as
 * it stands; on or after it, it is a balance known later, and the opening is
 * that balance less the movement through the day, dated the day before the
 * first activity, so the entry never lands in the middle of its history.
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
    const first = account.firstActivityDate;
    const entry =
      first !== null && Temporal.PlainDate.compare(request.date, first) >= 0
        ? {
            ...request,
            date: dayBefore(first),
            amount: cents(
              request.amount -
                loadMovementThrough(
                  ledger.sqlite,
                  auth,
                  account.accountId,
                  request.date,
                ),
            ),
          }
        : request;

    const existing = findOpeningBalancesAccount(tx, auth);
    if (existing !== null && existing.account_type !== "Equity") {
      return { kind: "opening-balances-not-equity" };
    }
    const equityAccount = existing ?? createOpeningBalancesAccount(tx, auth);

    const [journalId] = insertJournalPlan(
      tx,
      openingPlan(account.accountId, equityAccount.id, entry),
      auth,
    ).journalIds;
    return {
      kind: "recorded",
      accountName: account.name,
      journalId,
      equityAccount: { id: equityAccount.id, name: equityAccount.name },
      equityAccountCreated: existing === null,
      date: entry.date,
      amount: entry.amount,
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
    sourceNarration: null,
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
