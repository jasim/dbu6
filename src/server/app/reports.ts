import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import accountLedgerApi from "./reports/account-ledger.js";
import assetInflowsApi from "./reports/asset-inflows.js";
import balanceAssertionsApi from "./reports/balance-assertions.js";
import balanceSheetApi from "./reports/balance-sheet.js";
import draftBalanceAssertionsApi from "./reports/draft-balance-assertions.js";
import duplicateDraftsApi from "./reports/duplicate-drafts.js";
import expenseBreakdownApi from "./reports/expense-breakdown.js";
import incomeExpensesApi from "./reports/income-expenses.js";
import incomeStatementApi from "./reports/income-statement.js";
import lastReconciledApi from "./reports/last-reconciled.js";
import monthlySummaryApi from "./reports/monthly-summary.js";
import netWorthApi from "./reports/net-worth.js";
import trialBalanceApi from "./reports/trial-balance.js";

const api = new TsRestApi<SapportaEnv>();

function mountReport(reportApi: TsRestApi<SapportaEnv>) {
  api.route("/", reportApi);
  api.extend(reportApi as unknown as { docEmitters: readonly never[] });
}

mountReport(trialBalanceApi);
mountReport(balanceSheetApi);
mountReport(incomeStatementApi);
mountReport(incomeExpensesApi);
mountReport(assetInflowsApi);
mountReport(expenseBreakdownApi);
mountReport(accountLedgerApi);
mountReport(monthlySummaryApi);
mountReport(netWorthApi);
mountReport(lastReconciledApi);
mountReport(balanceAssertionsApi);
mountReport(draftBalanceAssertionsApi);
mountReport(duplicateDraftsApi);

export default api;
