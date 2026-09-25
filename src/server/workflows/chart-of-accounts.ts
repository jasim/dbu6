import type { ChartAccount, ChartOfAccounts } from "../../shared/index.js";
import {
  insertChartAccounts,
  loadAccountChart,
} from "../modules/accounts/index.js";
import {
  STARTER_CHART,
  STARTER_UNTICKED,
  validateChartProposal,
} from "../modules/chart-of-accounts/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";

/*
 * Step 1 of the setup wizard, the chart of accounts. Books with no accounts
 * at all start from a proposal the user ticks through; creating it inserts
 * the ticked accounts, parents first, in one transaction. Books with any
 * account, even one made by hand, show their own chart and are changed on
 * the Accounts page.
 */

/** The starter chart for books with no accounts, or the books' own chart. */
export function loadChartOfAccounts(ledger: Ledger): ChartOfAccounts {
  const accounts = loadAccountChart(ledger.db, ledger.auth);
  if (accounts.length === 0) {
    return {
      state: "new",
      starter: { accounts: [...STARTER_CHART] },
      unticked: [...STARTER_UNTICKED],
    };
  }
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return {
    state: "existing",
    chart: {
      accounts: accounts.map((account) => ({
        name: account.name,
        account_type: account.account_type,
        parent:
          account.parent_id === null
            ? null
            : (names.get(account.parent_id) ?? null),
        note: null,
      })),
    },
  };
}

export type ChartCreation =
  | { ok: true; created: number }
  | {
      ok: false;
      code: "books_have_accounts" | "invalid_chart";
      problems: string[];
    };

/** Creates the chart in books with no accounts, or says why it can't. */
export function createChart(
  ledger: Ledger,
  accounts: readonly ChartAccount[],
): ChartCreation {
  const valid = validateChartProposal(accounts);
  if (!valid.ok) {
    return { ok: false, code: "invalid_chart", problems: valid.problems };
  }
  return ledger.db.transaction((tx: any): ChartCreation => {
    if (loadAccountChart(tx, ledger.auth).length > 0) {
      return {
        ok: false,
        code: "books_have_accounts",
        problems: [
          "Your books already have accounts; change them on the Accounts page.",
        ],
      };
    }
    const created = insertChartAccounts(tx, ledger.auth, valid.accounts);
    return { ok: true, created: created.length };
  });
}
