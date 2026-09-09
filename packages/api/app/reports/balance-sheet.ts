import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { allRows, authorizeReport, ledgerCtes } from "./shared.js";
import {
  sectionAccountResult,
  sectionFooterRow,
  sectionTotal,
  type SectionAccountRow,
} from "./section-account-grid.js";

const api = new TsRestApi<SapportaEnv>();

api.register("balanceSheet", reportsContract.balanceSheet, ({ c, request }) => {
  const scope = authorizeReport(c, "balance-sheet");
  const rows = allRows<SectionAccountRow>(
    c.get("sqlite"),
    `${ledgerCtes}
    SELECT
      a.account_type AS section,
      a.id AS account_id,
      a.name,
      CASE WHEN a.account_type IN ('Liability', 'Equity')
           THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
           ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
      END AS balance
    FROM scoped_accounts a
    LEFT JOIN (
      SELECT je.account_id, je.debit, je.credit
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      WHERE j.date <= @asOfDate
    ) je ON je.account_id = a.id
    WHERE a.account_type IN ('Asset', 'Liability', 'Equity')
      AND NOT EXISTS (
        SELECT 1 FROM scoped_accounts child WHERE child.parent_id = a.id
      )
    GROUP BY a.account_type, a.id, a.name
    HAVING COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) != 0
    ORDER BY a.account_type, a.name`,
    { ...scope, asOfDate: request.query.as_of_date },
  );

  return { status: 200, body: toBalanceSheetResult(rows) };
});

function toBalanceSheetResult(rows: SectionAccountRow[]): GridDataset {
  const sections = ["Asset", "Liability", "Equity"];
  const result = sectionAccountResult({
    name: "balance-sheet",
    label: "Balance Sheet",
    sections,
    rows,
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
