import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { loadAccountAmounts } from "./account-amounts.js";
import { authorizeReport } from "./shared.js";
import type { LedgerAuth } from "../../modules/ledger-sql/index.js";
import {
  sectionAccountResult,
  sectionFooterRow,
  sectionTotal,
  type SectionAccount,
} from "./section-account-grid.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "incomeStatement",
  reportsContract.incomeStatement,
  ({ c, request }) => {
    const auth = authorizeReport(c, "income-statement");
    return {
      status: 200,
      body: incomeStatementReport(c.get("sqlite"), auth, {
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      }),
    };
  },
);

/**
 * Every income and expense account down the account tree, with its amount in
 * the period: its own entries and everything below it.
 */
export function incomeStatementReport(
  sqlite: Database.Database,
  auth: LedgerAuth,
  query: { fromDate: string | null; toDate: string | null },
): GridDataset {
  const { fromDate, toDate } = query;
  const accounts = loadAccountAmounts(sqlite, auth, {
    types: ["Revenue", "Expense"],
    fromDate,
    toDate,
  });
  return toIncomeStatementResult(accounts);
}

function toIncomeStatementResult(accounts: SectionAccount[]): GridDataset {
  const result = sectionAccountResult({
    name: "income-statement",
    label: "Income Statement",
    sections: ["Revenue", "Expense"],
    accounts,
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
