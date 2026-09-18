import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { loadAccountAmounts } from "./account-amounts.js";
import { authorizeReport } from "./shared.js";
import type { ScopeParams } from "../../modules/ledger-sql/index.js";
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
    return {
      status: 200,
      body: incomeStatementReport(c.get("sqlite"), {
        ...scope,
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      }),
    };
  },
);

/**
 * Every income and expense account with entries of its own in the period,
 * parents included, since an entry can sit on a parent account.
 */
export function incomeStatementReport(
  sqlite: Database.Database,
  query: ScopeParams & { fromDate: string | null; toDate: string | null },
): GridDataset {
  const { fromDate, toDate, ...scope } = query;
  const rows = loadAccountAmounts(sqlite, scope, {
    types: ["Revenue", "Expense"],
    fromDate,
    toDate,
  })
    .filter((account) => account.amount !== 0)
    .map((account): SectionAccountRow => ({
      section: account.account_type,
      account_id: account.account_id,
      name: account.name,
      balance: account.amount,
    }));
  return toIncomeStatementResult(rows);
}

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
