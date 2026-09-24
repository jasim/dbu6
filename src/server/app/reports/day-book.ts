import {
  accountLedgerLink,
  footerRow,
  type GridDataset,
  type GridDatasetNode,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  sum,
  textColumn,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register("dayBook", reportsContract.dayBook, ({ c, request }) => {
  const ledger = reportLedger(c, "day-book");
  return {
    status: 200,
    body: dayBookReport(ledger, {
      fromDate: request.query.from_date ?? null,
      toDate: request.query.to_date ?? null,
    }),
  };
});

/** One line of a journal in the period, with its journal's date and description. */
export type DayBookLineRow = {
  journal_id: number;
  date: string;
  description: string;
  entry_id: number;
  account_id: number;
  account_name: string;
  debit: number;
  credit: number;
  comment: string | null;
};

/**
 * Every line of every journal dated in the period, in date order, a day's
 * journals in the order they were entered and a journal's lines in its own
 * order (the order the journal's page lists them).
 */
export function loadDayBookLines(
  ledger: ReportLedger,
  query: { fromDate: string | null; toDate: string | null },
): DayBookLineRow[] {
  return ledger.all<DayBookLineRow>(
    `
    SELECT
      j.id AS journal_id,
      j.date,
      j.description,
      je.id AS entry_id,
      je.account_id,
      a.name AS account_name,
      je.debit,
      je.credit,
      je.comment
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    WHERE (@fromDate IS NULL OR j.date >= @fromDate)
      AND (@toDate IS NULL OR j.date <= @toDate)
    ORDER BY j.date, j.id, je.id`,
    query,
  );
}

export function dayBookReport(
  ledger: ReportLedger,
  query: { fromDate: string | null; toDate: string | null },
): GridDataset {
  return toDayBookResult(loadDayBookLines(ledger, query));
}

/** The hidden column holding the row key of a row's parent in the tree. */
const PARENT_KEY = "parent_key";

/*
 * One tree level, three kinds of row, all in one set of columns so a day
 * reads down a single header, as a printed day book does:
 *
 *   day      its date in Particulars, and the day's debits and credits
 *   journal  its description; no amounts, since its lines carry them
 *   line     its account, its debit or credit, and its comment
 *
 * Every row starts open, so a day's journals and their lines show without a
 * click. An amount shows once, on its line, and the day row adds them up.
 * The journal row stays blank there: its debits and credits are equal, and
 * repeating them over two lines of the same amount is noise. This reads the
 * same whether the importer wrote one journal per statement row (the
 * narration as its description) or one per run of rows ("Expenses", with
 * each narration in its line's comment).
 */
export function toDayBookResult(lines: DayBookLineRow[]): GridDataset {
  const columns = [
    hiddenIdColumn("journal_id", "Journal ID"),
    hiddenIdColumn("entry_id", "Entry ID"),
    hiddenIdColumn("account_id", "Account ID"),
    {
      id: PARENT_KEY,
      label: "Parent",
      kind: "text" as const,
      visuallyHidden: true,
    },
    { id: "date", label: "Date", kind: "date" as const, visuallyHidden: true },
    textColumn("particulars", "Particulars", {
      minWidth: 28,
      maxWidth: 64,
      // Only a journal row has a journal_id, and only a line an
      // account_id, so each kind of row gets its own link.
      links: [
        openRecordLink("journals", "journal_id", "Open journal"),
        accountLedgerLink({ account_id: "account_id", to_date: "date" }),
      ],
    }),
    moneyColumn("debit", "Debit", { width: 16, zeroDisplay: "blank" }),
    moneyColumn("credit", "Credit", { width: 16, zeroDisplay: "blank" }),
    textColumn("comment", "Comment", {
      minWidth: 20,
      maxWidth: 64,
      textDisplay: "multiLine",
    }),
  ];

  const nodes: GridDatasetNode[] = [];
  for (const day of groupBy(lines, (line) => line.date)) {
    const dayKey = `day:${day.key}`;
    nodes.push({
      rowKey: dayKey,
      levelName: "day_book",
      columns: {
        [PARENT_KEY]: null,
        date: day.key,
        particulars: dayLabel(day.key),
        debit: sum(day.rows, "debit"),
        credit: sum(day.rows, "credit"),
      },
    });
    for (const journal of groupBy(day.rows, (line) => line.journal_id)) {
      const journalKey = `journal:${journal.key}`;
      nodes.push({
        rowKey: journalKey,
        levelName: "day_book",
        columns: {
          [PARENT_KEY]: dayKey,
          journal_id: journal.key,
          date: day.key,
          particulars: journal.rows[0]!.description,
        },
      });
      for (const line of journal.rows) {
        nodes.push({
          rowKey: `entry:${line.entry_id}`,
          levelName: "day_book",
          columns: {
            [PARENT_KEY]: journalKey,
            entry_id: line.entry_id,
            account_id: line.account_id,
            date: day.key,
            particulars: line.account_name,
            debit: line.debit,
            credit: line.credit,
            comment: line.comment,
          },
        });
      }
    }
  }

  return {
    name: "day-book",
    label: "Day Book",
    rootLevel: "day_book",
    levels: {
      day_book: {
        columns,
        childLevels: [],
        tree: { parentColumn: PARENT_KEY, column: "particulars" },
        rowLinks: [
          openRecordLink("journal_entries", "entry_id", "Open journal entry"),
          openRecordLink("accounts", "account_id", "Open account"),
        ],
      },
    },
    nodes,
    footerRows:
      lines.length === 0
        ? undefined
        : [
            footerRow(
              {
                rowKey: "total",
                label: "Total",
                columns: {
                  debit: sum(lines, "debit"),
                  credit: sum(lines, "credit"),
                },
              },
              columns,
            ),
          ],
  };
}

/** Consecutive rows with the same key, in order: the rows arrive sorted. */
function groupBy<T, K>(
  rows: readonly T[],
  keyOf: (row: T) => K,
): { key: K; rows: T[] }[] {
  const groups: { key: K; rows: T[] }[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups;
}

/** "Saturday, 10 January 2026", as Home names today. */
export function dayLabel(date: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}

export default api;
