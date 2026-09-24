import {
  dateColumn,
  type GridDataset,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  subtree,
  sum,
  textColumn,
  type TreeAccount,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "accountLedger",
  reportsContract.accountLedger,
  ({ c, request }) => {
    const ledger = reportLedger(c, "account-ledger");
    const query: AccountLedgerQuery = {
      accountId: request.query.account_id,
      accountIds: ledgerAccountIds(ledger, request.query.account_id),
      fromDate: request.query.from_date ?? null,
      toDate: request.query.to_date ?? null,
    };
    const account = ledger.one<AccountInfoRow>(
      `${accountTreeCte}
    SELECT
      a.id,
      a.name,
      CASE WHEN @fromDate IS NULL THEN 0
           ELSE COALESCE((
             SELECT SUM(je.debit - je.credit)
             FROM scoped_journal_entries je
             JOIN scoped_journals j ON j.id = je.journal_id
             WHERE je.account_id IN (SELECT id FROM account_tree)
               AND j.date < @fromDate
           ), 0)
      END AS opening_balance
    FROM scoped_accounts a
    WHERE a.id = @accountId`,
      treeParams(query),
    );
    const journals = ledger.all<AccountLedgerJournalRow>(
      `${accountTreeCte}
    SELECT DISTINCT j.id AS journal_id, j.date, j.description
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    WHERE je.account_id IN (SELECT id FROM account_tree)
      AND (@fromDate IS NULL OR j.date >= @fromDate)
      AND (@toDate IS NULL OR j.date <= @toDate)
    ORDER BY j.date, j.id`,
      treeParams(query),
    );
    const journalEntries = loadAccountLedgerJournalEntries(ledger, query);

    return {
      status: 200,
      body: toAccountLedgerResult(
        account,
        query.accountIds,
        journals,
        journalEntries,
        request.query.from_date ?? null,
      ),
    };
  },
);

type AccountInfoRow = {
  id: number;
  name: string;
  opening_balance: number;
};

type AccountLedgerJournalRow = {
  journal_id: number;
  date: string;
  description: string;
};

type AccountLedgerJournalEntryRow = {
  entry_id: number;
  journal_id: number;
  account_id: number;
  account_name: string;
  debit: number;
  credit: number;
  comment: string | null;
};

type AccountLedgerQuery = {
  accountId: number;
  /** The account and every account under it (`ledgerAccountIds`). */
  accountIds: readonly number[];
  fromDate: string | null;
  toDate: string | null;
};

/**
 * The ledger's account and every account under it, from the accounts in
 * scope. Throws on a loop in `parent_id` anywhere among them (`subtree`).
 */
export function ledgerAccountIds(
  ledger: ReportLedger,
  accountId: number,
): number[] {
  const accounts = ledger.all<TreeAccount>(
    `SELECT id AS account_id, parent_id FROM scoped_accounts`,
  );
  return subtree(accounts, accountId).map((account) => account.account_id);
}

/** `account_tree`: the query's `accountIds`, bound by `treeParams`. */
const accountTreeCte = `
    , account_tree AS (
      SELECT value AS id FROM json_each(@accountTree)
    )`;

function treeParams(query: AccountLedgerQuery) {
  return { ...query, accountTree: JSON.stringify(query.accountIds) };
}

export function loadAccountLedgerJournalEntries(
  ledger: ReportLedger,
  query: AccountLedgerQuery,
): AccountLedgerJournalEntryRow[] {
  return ledger.all<AccountLedgerJournalEntryRow>(
    `${accountTreeCte},
    matching_journals AS (
      SELECT DISTINCT j.id
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      WHERE je.account_id IN (SELECT id FROM account_tree)
        AND (@fromDate IS NULL OR j.date >= @fromDate)
        AND (@toDate IS NULL OR j.date <= @toDate)
    )
    SELECT
      je.id AS entry_id,
      je.journal_id,
      je.account_id,
      a.name AS account_name,
      je.debit,
      je.credit,
      je.comment
    FROM scoped_journal_entries je
    JOIN matching_journals mj ON mj.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    ORDER BY je.journal_id, je.id`,
    treeParams(query),
  );
}

/**
 * One row of the ledger: an amount the account moved, the account it moved
 * against, and why.
 */
export type LedgerPosting = {
  key: string;
  entry_id: number;
  narration: string;
  against: string | null;
  /** Set when the row is against one account, for its ledger link. */
  against_account_id: number | null;
  debit: number;
  credit: number;
};

/**
 * A journal's rows in the ledger: one per line on the ledger's accounts, in
 * line order, against the lines on the journal's other side. Double entry
 * says only that the sides balance, not which debit met which credit, so a
 * line has one account against it only where the journal makes that exact:
 *
 * - The other side is one line: the row is against it. Narrated by the
 *   line's own comment, else that line's, else the journal's description.
 * - The journal is a day of statement rows as the importer grouped them
 *   before it wrote one journal per row (`isGroupedImport`), and the line is
 *   the statement account's, alone on its side: one row per statement row,
 *   for its amount, narrated by its comment.
 * - Otherwise, a compound entry such as a salary or a loan instalment: one row
 *   for the line, against every account on the other side, narrated by the
 *   line's comment, else the journal's description.
 */
export function ledgerPostings(
  journal: AccountLedgerJournalRow,
  lines: readonly AccountLedgerJournalEntryRow[],
  inLedger: (accountId: number) => boolean,
): LedgerPosting[] {
  const side = (line: AccountLedgerJournalEntryRow) =>
    Math.sign(Number(line.debit) - Number(line.credit));
  const amount = (line: AccountLedgerJournalEntryRow) =>
    Math.abs(Number(line.debit) - Number(line.credit));

  return lines
    .filter((line) => inLedger(line.account_id))
    .flatMap((line): LedgerPosting[] => {
      const direction = side(line);
      const posting = (
        key: string,
        value: number,
        narration: string,
        against: readonly AccountLedgerJournalEntryRow[],
      ): LedgerPosting => ({
        key,
        entry_id: line.entry_id,
        narration,
        against:
          [...new Set(against.map((other) => other.account_name))].join(", ") ||
          null,
        against_account_id: against.length === 1 ? against[0].account_id : null,
        debit: direction > 0 ? value : 0,
        credit: direction < 0 ? value : 0,
      });
      const others = lines.filter((other) => other !== line);
      const opposite = others.filter(
        (other) => direction !== 0 && side(other) === -direction,
      );

      if (opposite.length === 1) {
        return [
          posting(
            `entry:${line.entry_id}`,
            amount(line),
            narrate(line.comment, opposite[0].comment, journal.description),
            opposite,
          ),
        ];
      }
      const alone = others.every((other) => side(other) !== direction);
      if (
        direction !== 0 &&
        alone &&
        opposite.length > 1 &&
        isGroupedImport(journal)
      ) {
        return opposite.map((other) =>
          posting(
            `entry:${line.entry_id}:${other.entry_id}`,
            amount(other),
            narrate(other.comment, journal.description),
            [other],
          ),
        );
      }
      return [
        posting(
          `entry:${line.entry_id}`,
          amount(line),
          narrate(line.comment, journal.description),
          opposite.length > 0 ? opposite : others,
        ),
      ];
    });
}

/**
 * The account's postings in the period as the report's rows (`ledgerPostings`),
 * each with the balance it leaves and links to its journal. The label names
 * the account, for the screen's title; the footer closes the period.
 */
export function toAccountLedgerResult(
  account: AccountInfoRow | null,
  accountIds: readonly number[],
  journals: AccountLedgerJournalRow[],
  journalEntryRows: AccountLedgerJournalEntryRow[],
  fromDate: string | null,
): GridDataset {
  const openJournal = openRecordLink("journals", "journal_id", "Open journal");
  const levels = {
    entries: {
      // As a ledger book reads: the account on the other side, then why. The
      // short, fixed-width name lines up down the page; the narration, long
      // and cut to fit, takes the room left before the amounts.
      columns: [
        hiddenIdColumn("journal_id", "Journal ID"),
        hiddenIdColumn("entry_id", "Entry ID"),
        hiddenIdColumn("against_account_id", "Against Account ID"),
        dateColumn("date", "Date", { width: 15 }),
        // The text columns give way so the amounts, and the balance footer
        // under them, stay on screen at laptop widths. The screen links
        // Against to that account's ledger for the same period.
        textColumn("against", "Against", { minWidth: 16, maxWidth: 40 }),
        textColumn("narration", "Narration", {
          minWidth: 20,
          maxWidth: 56,
          links: [openJournal],
        }),
        moneyColumn("debit", "Debit", { width: 16, zeroDisplay: "blank" }),
        moneyColumn("credit", "Credit", { width: 16, zeroDisplay: "blank" }),
        moneyColumn("balance", "Balance", { width: 18, strong: true }),
      ],
      childLevels: [],
      // The journal's other lines are a click away, not nested in the page.
      rowLinks: [
        openJournal,
        openRecordLink("journal_entries", "entry_id", "Open journal entry"),
      ],
    },
  };
  if (account === null) {
    return {
      name: "account-ledger",
      label: "Account Ledger",
      rootLevel: "entries",
      levels,
      nodes: [],
    };
  }

  const ledgerAccounts = new Set(accountIds);
  const inLedger = (accountId: number) => ledgerAccounts.has(accountId);
  const openingBalance = Number(account.opening_balance);
  let balance = openingBalance;
  const journalEntries = groupJournalEntries(journalEntryRows);
  const postings = journals.flatMap((journal) => {
    const lines = journalEntries.get(journal.journal_id) ?? [];
    return ledgerPostings(journal, lines, inLedger).map(
      ({ key, ...posting }) => {
        balance += posting.debit - posting.credit;
        return {
          rowKey: key,
          levelName: "entries",
          columns: {
            journal_id: journal.journal_id,
            date: journal.date,
            ...posting,
            balance,
          },
        };
      },
    );
  });
  const opening =
    fromDate !== null && openingBalance !== 0
      ? [
          {
            rowKey: `opening:${fromDate}`,
            levelName: "entries",
            kind: "opening" as const,
            columns: {
              journal_id: null,
              entry_id: null,
              against_account_id: null,
              date: fromDate,
              against: "Opening balance",
              narration: null,
              debit: 0,
              credit: 0,
              balance: openingBalance,
            },
          },
        ]
      : [];
  const postingColumns = postings.map((posting) => posting.columns);
  return {
    name: "account-ledger",
    label: `Account Ledger: ${account.name}`,
    rootLevel: "entries",
    levels,
    nodes: [...opening, ...postings],
    footerRows: [
      // One row: the period's debits and credits under their columns, and
      // the balance they leave. Labelled in Against, as the opening row is:
      // the first column is a date too narrow for it.
      {
        rowKey: "closing-balance",
        columns: {
          against: "Closing balance",
          debit: sum(postingColumns, "debit"),
          credit: sum(postingColumns, "credit"),
          balance,
        },
      },
    ],
  };
}

/**
 * Until 2026-09-24 the importer wrote a day's same-direction statement rows
 * as one journal, and described it only by that direction. Nothing else
 * writes these descriptions, and those journals stay in the books as written.
 */
function isGroupedImport(journal: AccountLedgerJournalRow): boolean {
  return (
    journal.description === "Expenses" || journal.description === "Deposits"
  );
}

/** The first of the texts that says something. */
function narrate(...texts: (string | null)[]): string {
  return texts.find((text) => text !== null && text.trim() !== "") ?? "";
}

function groupJournalEntries(
  rows: AccountLedgerJournalEntryRow[],
): Map<number, AccountLedgerJournalEntryRow[]> {
  const entriesByJournal = new Map<number, AccountLedgerJournalEntryRow[]>();
  for (const row of rows) {
    const entries = entriesByJournal.get(row.journal_id) ?? [];
    entries.push(row);
    entriesByJournal.set(row.journal_id, entries);
  }
  for (const entries of entriesByJournal.values()) {
    entries.sort((left, right) => left.entry_id - right.entry_id);
  }
  return entriesByJournal;
}

export default api;
