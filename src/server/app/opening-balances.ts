import {
  TsRestApi,
  type SapportaEnv,
  type ServerInferResponses,
} from "@sapporta/server";
import {
  openingBalancesContract,
  type OpeningBalanceRefusal,
  type OpeningBalances as OpeningBalancesBody,
} from "../../shared/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  loadOpeningBalances,
  recordOpeningBalance,
  type OpeningBalanceRequest,
} from "../workflows/opening-balances.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The opening balances screen's routes: every asset and liability account
 * with its opening entry, and posting one account's.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("list", openingBalancesContract.list, async ({ c }) => ({
  status: 200,
  body: listOpeningBalances(requireWorkflowLedger(c)),
}));

api.register("record", openingBalancesContract.record, async ({ c, request }) =>
  recordOpeningBalanceResponse(requireWorkflowLedger(c), {
    accountId: request.body.account_id,
    date: request.body.date,
    amount: request.body.amount,
    description: request.body.description,
  }),
);

export default api;

/** The accounts and their opening entries, in the contract's terms. */
export function listOpeningBalances(ledger: Ledger): OpeningBalancesBody {
  const { equityAccount, accounts } = loadOpeningBalances(ledger);
  return {
    equity_account: equityAccount,
    accounts: accounts.map((account) => ({
      account_id: account.accountId,
      name: account.name,
      path: account.path,
      account_type: account.accountType,
      first_activity_date: account.firstActivityDate,
      default_date: account.defaultDate,
      suggested_amount: account.suggestedAmount,
      opening: account.opening && {
        journal_id: account.opening.journal_id,
        date: account.opening.date,
        amount: account.opening.amount,
        description: account.opening.description,
      },
    })),
  };
}

type RecordResponse = ServerInferResponses<
  typeof openingBalancesContract.record,
  201 | 404 | 422
>;

/** Posts one account's opening entry, answered in the contract's terms. */
export function recordOpeningBalanceResponse(
  ledger: Ledger,
  request: OpeningBalanceRequest,
): RecordResponse {
  const outcome = recordOpeningBalance(ledger, request);
  switch (outcome.kind) {
    case "account-not-found":
      return { status: 404, body: { error: "Account not found" } };
    case "not-asset-or-liability":
      return refusal({
        code: "not_asset_or_liability",
        error: `${outcome.accountName} is not an asset or a liability`,
      });
    case "already-recorded":
      return refusal({
        code: "already_recorded",
        error: `${outcome.accountName} already has an opening entry, on ${outcome.opening.date}`,
      });
    case "date-not-before-first-activity":
      return refusal({
        code: "date_not_before_first_activity",
        error: `The opening entry must be dated before ${outcome.accountName}'s first transaction, on ${outcome.firstActivityDate}`,
        first_activity_date: outcome.firstActivityDate,
      });
    case "opening-balances-not-equity":
      return refusal({
        code: "opening_balances_not_equity",
        error: "The account named Opening Balances is not an Equity account",
      });
    case "recorded":
      return {
        status: 201,
        body: {
          journal_id: outcome.journalId,
          equity_account: outcome.equityAccount,
          equity_account_created: outcome.equityAccountCreated,
        },
      };
  }
}

function refusal(body: OpeningBalanceRefusal): RecordResponse {
  return { status: 422, body };
}
