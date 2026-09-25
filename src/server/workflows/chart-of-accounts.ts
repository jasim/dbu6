import type {
  ChartAccount,
  ChartOfAccounts,
  ChartProposal,
} from "../../shared/index.js";
import {
  insertChartAccounts,
  loadAccountChart,
} from "../modules/accounts/index.js";
import {
  chartRequest,
  normalizeChartProposal,
  STARTER_CHART,
  STARTER_UNTICKED,
  validateChartProposal,
  type ChartLlm,
} from "../modules/chart-of-accounts/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";

/*
 * Step 1 of the setup wizard, the chart of accounts. Books with no accounts
 * at all start from a proposal the user ticks through; creating it inserts
 * the ticked accounts, parents first, in one transaction. Books with any
 * account, even one made by hand, show their own chart and are changed on
 * the Accounts page.
 *
 * The user can also describe how money moves for them and have the LLM
 * revise the proposal on screen (`suggestChart`), in as many rounds as they
 * like. That call reads and writes nothing; its answer is only a proposal.
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

export type ChartSuggestion =
  | { ok: true; proposal: ChartProposal; notes: string[] }
  | { ok: false; code: "llm_unavailable" | "llm_failed"; error: string };

/**
 * The LLM's revision of `current` to fit `description`, fixed where that
 * needs no guess, with a note for each fix. One call, never retried.
 */
export async function suggestChart(
  llm: ChartLlm,
  description: string,
  current: readonly ChartAccount[],
): Promise<ChartSuggestion> {
  if (!llm.caller.ready) {
    return { ok: false, code: "llm_unavailable", error: llm.caller.reason };
  }
  const answer = await llm.caller.client.get(
    chartRequest(description, current),
  );
  if (!answer.ok) {
    return {
      ok: false,
      code: "llm_failed",
      error: `${llm.name} couldn't propose accounts: ${answer.error}`,
    };
  }
  const normalized = normalizeChartProposal(answer.value.accounts);
  return {
    ok: true,
    proposal: { accounts: normalized.accounts },
    notes: normalized.notes,
  };
}
