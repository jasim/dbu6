import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  allRows,
  authorizeReport,
  dateColumn,
  hiddenIdColumn,
  ledgerCtes,
  moneyColumn,
  oneRow,
  openRecordLink,
  sum,
  textColumn,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "accountLedger",
  reportsContract.accountLedger,
  ({ c, request }) => {
    const scope = authorizeReport(c, "account-ledger");
    const sqlite = c.get("sqlite");
    const query = {
      ...scope,
      accountId: request.query.account_id,
      fromDate: request.query.from_date ?? null,
      toDate: request.query.to_date ?? null,
    };
    const account = oneRow<AccountInfoRow>(
      sqlite,
      `${ledgerCtes}${accountTreeCte}
    SELECT
      a.id,
      a.name,
      a.account_type,
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
      query,
    );
    const rows = allRows<AccountLedgerTransactionRow>(
      sqlite,
      `${ledgerCtes}${accountTreeCte}
    SELECT
      j.id AS journal_id,
      j.date,
      j.description,
      COALESCE(SUM(je.debit), 0) AS debit,
      COALESCE(SUM(je.credit), 0) AS credit,
      (
        SELECT GROUP_CONCAT(name, ', ')
        FROM (
          SELECT DISTINCT a.name
          FROM scoped_journal_entries je2
          JOIN scoped_accounts a ON a.id = je2.account_id
          WHERE je2.journal_id = j.id
            AND je2.account_id NOT IN (SELECT id FROM account_tree)
          ORDER BY a.name
        )
      ) AS accounts
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    WHERE je.account_id IN (SELECT id FROM account_tree)
      AND (@fromDate IS NULL OR j.date >= @fromDate)
      AND (@toDate IS NULL OR j.date <= @toDate)
    GROUP BY j.id, j.date, j.description
    ORDER BY j.date, j.id`,
      query,
    );
    const journalEntries = loadAccountLedgerJournalEntries(sqlite, query);

    return {
      status: 200,
      body: toAccountLedgerResult(
        account,
        rows,
        journalEntries,
        request.query.from_date ?? null,
      ),
    };
  },
);

type AccountInfoRow = {
  id: number;
  name: string;
  account_type: string;
  opening_balance: number;
};

type AccountLedgerTransactionRow = {
  journal_id: number;
  date: string;
  description: string;
  accounts: string | null;
  debit: number;
  credit: number;
};

type AccountLedgerJournalEntryRow = {
  entry_id: number;
  journal_id: number;
  account_id: number;
  account_name: string;
  debit: number;
  credit: number;
  assertion: number | null;
  comment: string | null;
};

type AccountLedgerQuery = {
  workspaceId: string;
  userId: string;
  accountId: number;
  fromDate: string | null;
  toDate: string | null;
};

/**
 * `account_tree`: the ledger's account and every account under it. `UNION`,
 * not `UNION ALL`, so a loop in `parent_id` ends instead of recursing forever.
 */
const accountTreeCte = `
    , account_tree AS (
      SELECT id FROM scoped_accounts WHERE id = @accountId
      UNION
      SELECT a.id
      FROM scoped_accounts a
      JOIN account_tree t ON a.parent_id = t.id
    )`;

export function loadAccountLedgerJournalEntries(
  sqlite: Parameters<typeof allRows>[0],
  query: AccountLedgerQuery,
): AccountLedgerJournalEntryRow[] {
  return allRows<AccountLedgerJournalEntryRow>(
    sqlite,
    `${ledgerCtes}${accountTreeCte},
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
      je.account_balance_assertion AS assertion,
      je.comment
    FROM scoped_journal_entries je
    JOIN matching_journals mj ON mj.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    ORDER BY je.journal_id, je.id`,
    query,
  );
}

export function toAccountLedgerResult(
  account: AccountInfoRow | null,
  rows: AccountLedgerTransactionRow[],
  journalEntryRows: AccountLedgerJournalEntryRow[],
  fromDate: string | null,
): GridDataset {
  const levelColumns = {
    account: [
      hiddenIdColumn("id", "Account ID"),
      // Fills the row, so the entries nested under it can use the full width.
      textColumn("name", "Account Name", {
        minWidth: 52,
        links: [openRecordLink("accounts", "id", "Open account")],
      }),
      textColumn("account_type", "Account Type", { width: 16 }),
    ],
    entries: [
      hiddenIdColumn("journal_id", "Journal ID"),
      dateColumn("date", "Date", { width: 15 }),
      // The text columns give way so the amounts, and the balance footers
      // under them, stay on screen at laptop widths.
      textColumn("description", "Description", {
        minWidth: 20,
        maxWidth: 56,
        links: [openRecordLink("journals", "journal_id", "Open journal")],
      }),
      textColumn("accounts", "Accounts", { minWidth: 16, maxWidth: 52 }),
      moneyColumn("debit", "Debit", { width: 16, zeroDisplay: "blank" }),
      moneyColumn("credit", "Credit", { width: 16, zeroDisplay: "blank" }),
      moneyColumn("balance", "Balance", { width: 18, strong: true }),
    ],
    journal_entries: [
      hiddenIdColumn("entry_id", "Entry ID"),
      hiddenIdColumn("account_id", "Account ID"),
      textColumn("account_name", "Account", { minWidth: 16, maxWidth: 52 }),
      moneyColumn("debit", "Debit", { width: 16, zeroDisplay: "blank" }),
      moneyColumn("credit", "Credit", { width: 16, zeroDisplay: "blank" }),
      moneyColumn("assertion", "Balance Assertion", {
        width: 18,
        strong: true,
      }),
      textColumn("comment", "Comment", {
        minWidth: 20,
        maxWidth: 56,
        textDisplay: "multiLine",
      }),
    ],
  };
  const openingBalance = Number(account?.opening_balance ?? 0);
  let balance = openingBalance;
  const journalEntries = groupJournalEntries(journalEntryRows);
  const entries = rows.map((row) => {
    balance += Number(row.debit ?? 0) - Number(row.credit ?? 0);
    return {
      rowKey: `journal:${row.journal_id}`,
      levelName: "entries",
      columns: { ...row, balance },
      children: {
        journal_entries: (journalEntries.get(row.journal_id) ?? []).map(
          (entry) => ({
            rowKey: `entry:${entry.entry_id}`,
            levelName: "journal_entries",
            columns: entry,
          }),
        ),
      },
    };
  });
  const visibleEntries =
    fromDate !== null && openingBalance !== 0
      ? [
          {
            rowKey: `opening:${fromDate}`,
            levelName: "entries",
            kind: "opening" as const,
            columns: {
              journal_id: null,
              date: fromDate,
              description: "Opening balance",
              accounts: null,
              debit: 0,
              credit: 0,
              balance: openingBalance,
            },
          },
          ...entries,
        ]
      : entries;
  const data = account
    ? [
        {
          rowKey: `account:${account.id}`,
          levelName: "account",
          columns: account,
          children: { entries: visibleEntries },
          childFooterRows: {
            // One row: the period's debits and credits under their columns,
            // and the balance they leave. Labelled in Description, as the
            // opening row is: the first column is a date too narrow for it.
            entries: [
              {
                rowKey: "closing-balance",
                columns: {
                  description: "Closing balance",
                  debit: sum(rows, "debit"),
                  credit: sum(rows, "credit"),
                  balance,
                },
              },
            ],
          },
        },
      ]
    : [];
  return {
    name: "account-ledger",
    label: "Account Ledger",
    rootLevel: "account",
    levels: {
      account: { columns: levelColumns.account, childLevels: ["entries"] },
      entries: {
        columns: levelColumns.entries,
        childLevels: ["journal_entries"],
        defaultCollapsed: true,
      },
      journal_entries: {
        columns: levelColumns.journal_entries,
        childLevels: [],
        rowLinks: [
          openRecordLink("journal_entries", "entry_id", "Open journal entry"),
          openRecordLink("accounts", "account_id", "Open account"),
        ],
      },
    },
    nodes: data,
  };
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
