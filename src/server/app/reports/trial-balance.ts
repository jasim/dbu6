import {
  type AccountType,
  accountTree,
  accountTreeLevel,
  accountTreeNodes,
  type AmountAccount,
  footerRow,
  type GridDataset,
  moneyColumn,
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  sum,
  textColumn,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";

const api = new TsRestApi<SapportaEnv>();

api.register("trialBalance", reportsContract.trialBalance, ({ c, request }) => {
  const ledger = reportLedger(c, "trial-balance");
  return {
    status: 200,
    body: trialBalanceReport(ledger, {
      asOfDate: request.query.as_of_date,
    }),
  };
});

/**
 * Every account's balance up to the date, down the account tree, the types
 * in chart order, each row with everything on and below it. The grand total
 * adds each account's own balance, so it balances however the tree nets
 * debits against credits.
 */
export function trialBalanceReport(
  ledger: ReportLedger,
  query: { asOfDate: string },
): GridDataset {
  const rows = ledger.all<TrialBalanceRow>(
    `
    SELECT
      a.id AS account_id,
      a.name,
      a.parent_id,
      a.account_type,
      COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) AS net_debit
    FROM scoped_accounts a
    LEFT JOIN (
      SELECT je.account_id, je.debit, je.credit
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      WHERE j.date <= @asOfDate
    ) je ON je.account_id = a.id
    GROUP BY a.id, a.name, a.parent_id, a.account_type`,
    query,
  );
  return toTrialBalanceResult(
    rows.map(({ net_debit, ...account }) => ({
      ...account,
      amount: normalSide(account.account_type, net_debit),
    })),
  );
}

type TrialBalanceRow = {
  account_id: number;
  name: string;
  parent_id: number | null;
  account_type: AccountType;
  net_debit: number;
};

/**
 * An account with its own entries' balance up to the date, on its type's
 * normal side, so that ranking by it puts the largest balance first in
 * every type.
 */
type TrialBalanceAccount = AmountAccount & { account_type: AccountType };

/** The account types in the order the tree's top accounts run. */
const typeOrder: readonly AccountType[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
];

const creditNormal: ReadonlySet<AccountType> = new Set([
  "Liability",
  "Equity",
  "Revenue",
]);

/**
 * A debit balance on the type's normal side, or a normal-side balance back
 * as a debit balance: a credit-normal type's sign flips either way.
 */
function normalSide(type: AccountType, amount: number): number {
  return creditNormal.has(type) ? -amount : amount;
}

/** A normal-side balance in the debit or the credit column. */
function debitCredit(type: AccountType, amount: number) {
  const debit = normalSide(type, amount);
  return { debit: Math.max(debit, 0), credit: Math.max(-debit, 0) };
}

function toTrialBalanceResult(accounts: TrialBalanceAccount[]): GridDataset {
  const level = accountTreeLevel({
    nameWidth: 42,
    columns: [
      textColumn("account_type", "Type", { width: 14 }),
      moneyColumn("debit", "Debit", { width: 16, zeroDisplay: "blank" }),
      moneyColumn("credit", "Credit", { width: 16, zeroDisplay: "blank" }),
    ],
  });
  const tree = typeOrder.flatMap((type) =>
    accountTree(accounts.filter((account) => account.account_type === type)),
  );
  const own = accounts.map((account) =>
    debitCredit(account.account_type, account.amount),
  );
  return {
    name: "trial-balance",
    label: "Trial Balance",
    rootLevel: "account",
    levels: { account: level },
    nodes: accountTreeNodes(tree, "account", (account, amount) => ({
      account_type: account.account_type,
      ...debitCredit(account.account_type, amount),
    })),
    footerRows: [
      footerRow(
        {
          rowKey: "grand-total",
          label: "Grand Total",
          columns: { debit: sum(own, "debit"), credit: sum(own, "credit") },
        },
        level.columns,
      ),
    ],
  };
}

export default api;
