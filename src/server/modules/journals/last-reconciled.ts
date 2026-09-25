import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/*
 * The last reconciled checkpoint: an account's latest posted balance
 * assertion, in the journal with the latest date and, on a tie, the highest
 * id. One query finds it. Home, Review and the last-reconciled report read it
 * for every account, and the statement import for the account it imports
 * into.
 */

export interface ReconciledCheckpoint {
  date: string;
  balance: number;
}

/** A balance assertion in an account's last reconciled journal. */
export type LastReconciledRow = {
  account_id: number;
  journal_id: number;
  account_name: string;
  last_reconciled_date: string;
  last_balance: number;
};

/**
 * The last reconciled checkpoint of every account, or of the one account
 * named `accountName` or with id `accountId`. An account whose last reconciled journal asserts its balance
 * more than once has a row for each assertion, and the last is its
 * checkpoint. Rows are ordered by account name, account id and entry id.
 */
export function loadLastReconciled(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
  filter: { accountName?: string; accountId?: number } = {},
): LastReconciledRow[] {
  return allRows<LastReconciledRow>(
    sqlite,
    auth,
    `
    SELECT
      a.id AS account_id,
      j.id AS journal_id,
      a.name AS account_name,
      j.date AS last_reconciled_date,
      je.account_balance_assertion AS last_balance
    FROM scoped_accounts a
    JOIN scoped_journal_entries je ON je.account_id = a.id
    JOIN scoped_journals j ON j.id = je.journal_id
    WHERE je.account_balance_assertion IS NOT NULL
      AND (@accountName IS NULL OR a.name = @accountName)
      AND (@accountId IS NULL OR a.id = @accountId)
      AND j.id = (
        SELECT je2.journal_id
        FROM scoped_journal_entries je2
        JOIN scoped_journals j2 ON j2.id = je2.journal_id
        WHERE je2.account_id = a.id
          AND je2.account_balance_assertion IS NOT NULL
        ORDER BY j2.date DESC, j2.id DESC
        LIMIT 1
      )
    ORDER BY a.name, a.id, je.id`,
    {
      accountName: filter.accountName ?? null,
      accountId: filter.accountId ?? null,
    },
  );
}

/**
 * The checkpoint a statement import into `accountName` starts from: that
 * account's last reconciled checkpoint. A name is unique in a user's books,
 * so it is one account's.
 */
export function lookupLastReconciled(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
  accountName: string,
): ReconciledCheckpoint | null {
  const last = loadLastReconciled(sqlite, auth, { accountName }).at(-1);
  return last === undefined
    ? null
    : { date: last.last_reconciled_date, balance: last.last_balance };
}

/**
 * A statement row the books hold on an account's checkpoint day, as the
 * account's statement shows it: `amount` is signed, a deposit positive.
 * `origin` says how it reached the books:
 * - "statement": this account's own import posted it, and `key` is the
 *   statement row's source key;
 * - "other-statement": another account's import posted it with this account
 *   as its category, as a card payment or a transfer is, so this account's
 *   statement keys it differently;
 * - "unkeyed": its journal carries no key, entered by hand or imported
 *   before rows were keyed.
 *
 * `counted` is true when the day's last posted balance check includes it:
 * the check adds a day up in journal id order, and its journal is the
 * check's own or an earlier one.
 */
export interface PostedRow {
  origin: "statement" | "other-statement" | "unkeyed";
  key: string | null;
  amount: number;
  narration: string;
  counted: boolean;
}

type PostedLine = {
  journal_id: number;
  description: string;
  account_id: number;
  debit: number;
  credit: number;
  comment: string | null;
  key: string | null;
  counted: number | null;
};

/**
 * The rows the books hold on `date` for the account, one for each statement
 * row a posted journal that day stands for. The statement import reads it for
 * the checkpoint's date (reconciliation/checkpoint-day.md).
 */
export function loadPostedRowsOn(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
  accountId: number,
  date: string,
): PostedRow[] {
  const lines = allRows<PostedLine>(
    sqlite,
    auth,
    `
    SELECT
      j.id AS journal_id,
      j.description,
      je.account_id,
      je.debit,
      je.credit,
      je.comment,
      je.source_transaction_key AS key,
      j.id <= (
        SELECT MAX(j3.id)
        FROM scoped_journals j3
        JOIN scoped_journal_entries je3 ON je3.journal_id = j3.id
        WHERE j3.date = @date
          AND je3.account_id = @accountId
          AND je3.account_balance_assertion IS NOT NULL
      ) AS counted
    FROM scoped_journals j
    JOIN scoped_journal_entries je ON je.journal_id = j.id
    WHERE j.date = @date
      AND j.id IN (
        SELECT je2.journal_id
        FROM scoped_journal_entries je2
        WHERE je2.account_id = @accountId
      )
    ORDER BY j.id, je.id`,
    { accountId, date },
  );
  const byJournal = new Map<number, PostedLine[]>();
  for (const line of lines) {
    byJournal.set(line.journal_id, [
      ...(byJournal.get(line.journal_id) ?? []),
      line,
    ]);
  }
  return [...byJournal.values()].flatMap((journal) =>
    postedRowsOf(journal, accountId),
  );
}

// An import keys the category line of each row it posts, never its own
// account's line (journal-plan). So a key on another account's line is this
// account's own row, and a key on this account's line is another account's
// row that has this account as its category. With no key, each line on
// another account is one row, as an older grouped import wrote them.
function postedRowsOf(journal: PostedLine[], accountId: number): PostedRow[] {
  const counted = journal[0].counted === 1;
  const narration = (line: PostedLine) => line.comment ?? line.description;
  const elsewhere = journal.filter((line) => line.account_id !== accountId);
  const own = elsewhere.filter((line) => line.key !== null);
  if (own.length > 0) {
    return own.map((line) => ({
      origin: "statement",
      key: line.key,
      amount: line.credit - line.debit,
      narration: narration(line),
      counted,
    }));
  }
  const other = journal.filter(
    (line) => line.account_id === accountId && line.key !== null,
  );
  if (other.length > 0) {
    return other.map((line) => ({
      origin: "other-statement",
      key: null,
      amount: line.debit - line.credit,
      narration: narration(line),
      counted,
    }));
  }
  return elsewhere.map((line) => ({
    origin: "unkeyed",
    key: null,
    amount: line.credit - line.debit,
    narration: narration(line),
    counted,
  }));
}
