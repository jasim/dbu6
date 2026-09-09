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

api.register(
  "incomeStatement",
  reportsContract.incomeStatement,
  ({ c, request }) => {
    const scope = authorizeReport(c, "income-statement");
    const rows = allRows<SectionAccountRow>(
      c.get("sqlite"),
      `${ledgerCtes}
      SELECT
        a.account_type AS section,
        a.id AS account_id,
        a.name,
        CASE WHEN a.account_type = 'Revenue'
             THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
             ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
        END AS balance
      FROM scoped_accounts a
      LEFT JOIN (
        SELECT je.account_id, je.debit, je.credit
        FROM scoped_journal_entries je
        JOIN scoped_journals j ON j.id = je.journal_id
        WHERE (@fromDate IS NULL OR j.date >= @fromDate)
          AND (@toDate IS NULL OR j.date <= @toDate)
      ) je ON je.account_id = a.id
      WHERE a.account_type IN ('Revenue', 'Expense')
        AND NOT EXISTS (
          SELECT 1 FROM scoped_accounts child WHERE child.parent_id = a.id
        )
      GROUP BY a.account_type, a.id, a.name
      HAVING CASE WHEN a.account_type = 'Revenue'
                  THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
                  ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
             END != 0
      ORDER BY a.account_type, a.name`,
      {
        ...scope,
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      },
    );

    return { status: 200, body: toIncomeStatementResult(rows) };
  },
);

function toIncomeStatementResult(rows: SectionAccountRow[]): GridDataset {
  const result = sectionAccountResult({
    name: "income-statement",
    label: "Income Statement",
    sections: ["Revenue", "Expense"],
    rows,
  });
  result.footerRows = [
    sectionFooterRow({
      rowKey: "net-income",
      label: "Net Income",
      columns: {
        section_total:
          sectionTotal(result.nodes, "Revenue") -
          sectionTotal(result.nodes, "Expense"),
      },
      result,
    }),
  ];
  return result;
}

export default api;
