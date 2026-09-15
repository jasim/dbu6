import type Database from "better-sqlite3";
import { allRows, ledgerCtes, type ScopeParams } from "./shared.js";

/*
 * Income and spending, per account and per month: the one source the
 * income statement, Spending breakdown, Monthly summary and Where your money
 * went read, so the page and the grids can't disagree. Amounts are signed so
 * that income and spending are both positive: Revenue is credit − debit,
 * Expense is debit − credit. A refund larger than the spending makes an
 * amount negative.
 */

export type IncomeSpendingType = "Revenue" | "Expense";

type Period = { fromDate: string | null; toDate: string | null };

/** An account and its own entries' amount in the period, children not included. */
export type AccountAmount = {
  account_id: number;
  name: string;
  parent_id: number | null;
  account_type: IncomeSpendingType;
  amount: number;
};

/**
 * Every account of the given types, ordered by name, with the amount of its
 * own entries in the period. Accounts without entries are listed with 0, so
 * a tree built from them keeps its parents.
 */
export function loadAccountAmounts(
  sqlite: Database.Database,
  scope: ScopeParams,
  query: Period & { types: readonly IncomeSpendingType[] },
): AccountAmount[] {
  return allRows<AccountAmount>(
    sqlite,
    `${ledgerCtes}
      SELECT
        a.id AS account_id,
        a.name,
        a.parent_id,
        a.account_type,
        CASE WHEN a.account_type = 'Revenue'
             THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
             ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
        END AS amount
      FROM scoped_accounts a
      LEFT JOIN (
        SELECT je.account_id, je.debit, je.credit
        FROM scoped_journal_entries je
        JOIN scoped_journals j ON j.id = je.journal_id
        WHERE (@fromDate IS NULL OR j.date >= @fromDate)
          AND (@toDate IS NULL OR j.date <= @toDate)
      ) je ON je.account_id = a.id
      WHERE a.account_type IN (SELECT value FROM json_each(@types))
      GROUP BY a.id, a.name, a.parent_id, a.account_type
      ORDER BY a.name, a.id`,
    {
      ...scope,
      fromDate: query.fromDate,
      toDate: query.toDate,
      types: JSON.stringify(query.types),
    },
  );
}

/** One month's income and spending. `month` is `YYYY-MM`. */
export type MonthlyAmount = {
  month: string;
  income: number;
  spending: number;
};

/**
 * Income and spending for each month in the period that has an entry on an
 * income or spending account, oldest first. Months without one are left out.
 */
export function loadMonthlyAmounts(
  sqlite: Database.Database,
  scope: ScopeParams,
  query: Period,
): MonthlyAmount[] {
  return allRows<MonthlyAmount>(
    sqlite,
    `${ledgerCtes}
      SELECT
        strftime('%Y-%m', j.date) AS month,
        COALESCE(SUM(CASE WHEN a.account_type = 'Revenue'
                          THEN je.credit - je.debit
                          ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN a.account_type = 'Expense'
                          THEN je.debit - je.credit
                          ELSE 0 END), 0) AS spending
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      JOIN scoped_accounts a ON a.id = je.account_id
      WHERE a.account_type IN ('Revenue', 'Expense')
        AND (@fromDate IS NULL OR j.date >= @fromDate)
        AND (@toDate IS NULL OR j.date <= @toDate)
      GROUP BY strftime('%Y-%m', j.date)
      ORDER BY strftime('%Y-%m', j.date)`,
    { ...scope, fromDate: query.fromDate, toDate: query.toDate },
  );
}
