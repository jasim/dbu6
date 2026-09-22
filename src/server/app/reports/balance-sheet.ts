import {
  type GridDataset,
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract } from "../../../shared/index.js";
import {
  sectionAccountResult,
  sectionFooterRow,
  sectionTotal,
  type SectionAccount,
} from "./section-account-grid.js";

const api = new TsRestApi<SapportaEnv>();

api.register("balanceSheet", reportsContract.balanceSheet, ({ c, request }) => {
  const ledger = reportLedger(c, "balance-sheet");
  return {
    status: 200,
    body: balanceSheetReport(ledger, {
      asOfDate: request.query.as_of_date,
    }),
  };
});

/**
 * Every asset, liability and equity account down the account tree, with its
 * balance up to the date: its own entries and everything below it. An
 * account without entries is kept at 0, so the tree keeps its parents.
 */
export function balanceSheetReport(
  ledger: ReportLedger,
  query: { asOfDate: string },
): GridDataset {
  const accounts = ledger.all<SectionAccount>(
    `
    SELECT
      a.id AS account_id,
      a.name,
      a.parent_id,
      a.account_type,
      CASE WHEN a.account_type IN ('Liability', 'Equity')
           THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
           ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
      END AS amount
    FROM scoped_accounts a
    LEFT JOIN (
      SELECT je.account_id, je.debit, je.credit
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      WHERE j.date <= @asOfDate
    ) je ON je.account_id = a.id
    WHERE a.account_type IN ('Asset', 'Liability', 'Equity')
    GROUP BY a.id, a.name, a.parent_id, a.account_type`,
    query,
  );
  return toBalanceSheetResult(accounts);
}

function toBalanceSheetResult(accounts: SectionAccount[]): GridDataset {
  const sections = ["Asset", "Liability", "Equity"];
  const result = sectionAccountResult({
    name: "balance-sheet",
    label: "Balance Sheet",
    sections,
    accounts,
  });
  const assets = sectionTotal(result.nodes, "Asset");
  const liabilities = sectionTotal(result.nodes, "Liability");
  const equity = sectionTotal(result.nodes, "Equity");
  result.footerRows = [
    sectionFooterRow({
      rowKey: "total-liabilities-equity",
      label: "Total Liabilities + Equity",
      columns: { section_total: liabilities + equity },
      result,
    }),
    sectionFooterRow({
      rowKey: "net",
      label: "Net",
      columns: { section_total: assets - (liabilities + equity) },
      result,
    }),
  ];
  return result;
}

export default api;
