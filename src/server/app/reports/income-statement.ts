import {
  type GridDataset,
  loadAccountAmounts,
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

api.register(
  "incomeStatement",
  reportsContract.incomeStatement,
  ({ c, request }) => {
    const ledger = reportLedger(c, "income-statement");
    return {
      status: 200,
      body: incomeStatementReport(ledger, {
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
  ledger: ReportLedger,
  query: { fromDate: string | null; toDate: string | null },
): GridDataset {
  const { fromDate, toDate } = query;
  const accounts = loadAccountAmounts(ledger, {
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
