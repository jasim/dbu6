import {
  type AccountAmount,
  type AccountNode,
  accountTree,
  type IncomeSpendingType,
  loadAccountAmounts,
  loadAccountMonthlyAmounts,
  loadMonthlyAmounts,
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import {
  reportsContract,
  type IncomeExpenses,
  type IncomeExpensesAccount,
  type IncomeExpensesEntries,
} from "../../../shared/index.js";
import {
  groupJournalEntries,
  ledgerPostings,
  loadAccountLedgerJournalEntries,
  loadLedgerJournals,
} from "./account-ledger.js";

/*
 * Income and Expenses (PLAN.md §11 P4): income and spending for a period
 * as two account trees, each account month by month, and the first month
 * there is anything to show; and a section's entries, which the page lists
 * beside the trees. Every figure comes from the amounts module the income
 * statement reads, so the two agree.
 */

const api = new TsRestApi<SapportaEnv>();

api.register(
  "incomeExpenses",
  reportsContract.incomeExpenses,
  ({ c, request }) => {
    const ledger = reportLedger(c, "income-expenses");
    return {
      status: 200,
      body: incomeExpensesReport(ledger, {
        fromDate: request.query.from_date,
        toDate: request.query.to_date,
      }),
    };
  },
);

api.register(
  "incomeExpensesEntries",
  reportsContract.incomeExpensesEntries,
  ({ c, request }) => {
    const ledger = reportLedger(c, "income-expenses");
    return {
      status: 200,
      body: incomeExpensesEntries(ledger, {
        fromDate: request.query.from_date,
        toDate: request.query.to_date,
        type: request.query.section === "income" ? "Revenue" : "Expense",
      }),
    };
  },
);

export default api;

export function incomeExpensesReport(
  ledger: ReportLedger,
  query: { fromDate: string; toDate: string },
): IncomeExpenses {
  const { fromDate, toDate } = query;
  const accounts = loadAccountAmounts(ledger, {
    types: ["Revenue", "Expense"],
    fromDate,
    toDate,
  });
  const inPeriod = new Map(
    loadMonthlyAmounts(ledger, { fromDate, toDate }).map((row) => [
      row.month,
      row,
    ]),
  );
  const byAccount = new Map<number, Map<string, number>>();
  for (const row of loadAccountMonthlyAmounts(ledger, {
    types: ["Revenue", "Expense"],
    fromDate,
    toDate,
  })) {
    const months = byAccount.get(row.account_id) ?? new Map<string, number>();
    months.set(row.month, row.amount);
    byAccount.set(row.account_id, months);
  }
  const months = monthsBetween(fromDate, toDate);
  const ownMonths = (accountId: number) => {
    const amounts = byAccount.get(accountId);
    return months.map((month) => amounts?.get(month) ?? 0);
  };
  const firstMonth =
    loadMonthlyAmounts(ledger, { fromDate: null, toDate: null })[0]?.month ??
    null;

  return {
    income: section(accounts, "Revenue", ownMonths),
    spending: section(accounts, "Expense", ownMonths),
    months: months.map(
      (month) => inPeriod.get(month) ?? { month, income: 0, spending: 0 },
    ),
    first_month: firstMonth,
  };
}

function section(
  accounts: readonly AccountAmount[],
  type: IncomeSpendingType,
  ownMonths: (accountId: number) => number[],
): IncomeExpenses["income"] {
  const nodes = accountTree(
    accounts.filter((account) => account.account_type === type),
  );
  const wireNode = (
    node: AccountNode<AccountAmount>,
  ): IncomeExpensesAccount => {
    const children = node.children.map(wireNode);
    return {
      account_id: node.account.account_id,
      name: node.account.name,
      own: node.own,
      total: node.total,
      // Its own months plus its children's, as `total` adds them.
      months: children.reduce(
        (sums, child) => sums.map((sum, index) => sum + child.months[index]),
        ownMonths(node.account.account_id),
      ),
      children,
    };
  };
  return {
    total: nodes.reduce((total, node) => total + node.total, 0),
    accounts: nodes.map(wireNode),
  };
}

/**
 * Every entry on a section's accounts in the period, oldest first: one per
 * line, narrated and set against the other side as the account ledger does
 * (`ledgerPostings`), so the two read alike.
 */
export function incomeExpensesEntries(
  ledger: ReportLedger,
  query: { fromDate: string; toDate: string; type: IncomeSpendingType },
): IncomeExpensesEntries {
  const accountIds = ledger
    .all<{ id: number }>(
      `SELECT id FROM scoped_accounts WHERE account_type = @type`,
      { type: query.type },
    )
    .map((row) => row.id);
  const inSection = new Set(accountIds);
  const ledgerQuery = {
    accountIds,
    fromDate: query.fromDate,
    toDate: query.toDate,
  };
  const lines = loadAccountLedgerJournalEntries(ledger, ledgerQuery);
  const accountOf = new Map(
    lines.map((line) => [line.entry_id, line.account_id]),
  );
  const journalLines = groupJournalEntries(lines);
  // Income is credit − debit and spending debit − credit, so both are
  // positive and a refund is negative.
  const sign = query.type === "Revenue" ? -1 : 1;
  return {
    entries: loadLedgerJournals(ledger, ledgerQuery).flatMap((journal) =>
      ledgerPostings(
        journal,
        journalLines.get(journal.journal_id) ?? [],
        (accountId) => inSection.has(accountId),
      ).map((posting) => ({
        key: posting.key,
        journal_id: journal.journal_id,
        date: journal.date,
        narration: posting.narration,
        against: posting.against,
        account_id: accountOf.get(posting.entry_id) ?? 0,
        amount: sign * (posting.debit - posting.credit),
      })),
    ),
  };
}

/** Every month, as `YYYY-MM`, from the first date's month to the second's. */
export function monthsBetween(fromDate: string, toDate: string): string[] {
  const months: string[] = [];
  let year = Number(fromDate.slice(0, 4));
  let month = Number(fromDate.slice(5, 7));
  const last = toDate.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > last) break;
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
