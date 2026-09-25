import {
  TsRestApi,
  type SapportaEnv,
  type ServerInferResponses,
} from "@sapporta/server";
import {
  openingBalancesContract,
  type OpeningBalanceRefusal,
  type OpeningBalances as OpeningBalancesBody,
  type OpeningLock,
} from "../../shared/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  changeOpeningBalance,
  loadOpeningBalances,
  recordOpeningBalance,
  removeOpeningBalance,
  type OpeningBalanceRequest,
} from "../workflows/opening-balances.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The opening balances routes, which C1 (/add/other) and Settings › Opening
 * balances read:
 * every asset and liability account with its opening entry, and posting,
 * changing or removing one account's.
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

api.register("change", openingBalancesContract.change, async ({ c, request }) =>
  changeOpeningBalanceResponse(requireWorkflowLedger(c), {
    accountId: request.params.accountId,
    date: request.body.date,
    amount: request.body.amount,
    description: request.body.description,
  }),
);

api.register("remove", openingBalancesContract.remove, async ({ c, request }) =>
  removeOpeningBalanceResponse(
    requireWorkflowLedger(c),
    request.params.accountId,
  ),
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
      section: account.section,
      first_activity_date: account.firstActivityDate,
      default_date: account.defaultDate,
      suggested_amount: account.suggestedAmount,
      opening: account.opening && {
        journal_id: account.opening.journal_id,
        date: account.opening.date,
        amount: account.opening.amount,
        description: account.opening.description,
        locked: account.opening.locked,
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
      return { status: 404, body: accountNotFound() };
    case "not-asset-or-liability":
      return { status: 422, body: notAssetOrLiability(outcome.accountName) };
    case "already-recorded":
      return {
        status: 422,
        body: {
          code: "already_recorded",
          error: `${outcome.accountName} already has an opening balance, from ${outcome.opening.date}.`,
        },
      };
    case "date-not-before-first-activity":
      return { status: 422, body: dateNotBeforeFirstActivity(outcome) };
    case "opening-balances-not-equity":
      return {
        status: 422,
        body: {
          code: "opening_balances_not_equity",
          error: "The account named Opening Balances is not an Equity account",
        },
      };
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

type ChangeResponse = ServerInferResponses<
  typeof openingBalancesContract.change,
  200 | 404 | 409 | 422
>;

/** Changes one account's opening entry, answered in the contract's terms. */
export function changeOpeningBalanceResponse(
  ledger: Ledger,
  request: OpeningBalanceRequest,
): ChangeResponse {
  const outcome = changeOpeningBalance(ledger, request);
  switch (outcome.kind) {
    case "account-not-found":
      return { status: 404, body: accountNotFound() };
    case "not-asset-or-liability":
      return { status: 422, body: notAssetOrLiability(outcome.accountName) };
    case "not-recorded":
      return { status: 404, body: notRecorded(outcome.accountName, "change") };
    case "locked":
      return { status: 409, body: locked(outcome) };
    case "date-not-before-first-activity":
      return { status: 422, body: dateNotBeforeFirstActivity(outcome) };
    case "changed":
      return { status: 200, body: { journal_id: outcome.journalId } };
  }
}

type RemoveResponse = ServerInferResponses<
  typeof openingBalancesContract.remove,
  200 | 404 | 409
>;

/** Deletes one account's opening entry, answered in the contract's terms. */
export function removeOpeningBalanceResponse(
  ledger: Ledger,
  accountId: number,
): RemoveResponse {
  const outcome = removeOpeningBalance(ledger, accountId);
  switch (outcome.kind) {
    case "account-not-found":
      return { status: 404, body: accountNotFound() };
    // Removing has no body to refuse, so an account that takes no opening
    // balance is one without one to remove.
    case "not-asset-or-liability":
      return { status: 404, body: notAssetOrLiability(outcome.accountName) };
    case "not-recorded":
      return { status: 404, body: notRecorded(outcome.accountName, "remove") };
    case "locked":
      return { status: 409, body: locked(outcome) };
    case "removed":
      return { status: 200, body: { removed_journal_id: outcome.journalId } };
  }
}

/*
 * The refusals' words, which the screens show as they are. One wording
 * for each, whichever route refuses.
 */

function accountNotFound(): OpeningBalanceRefusal {
  return {
    code: "account_not_found",
    error: "That account isn't in your books any more.",
  };
}

function notAssetOrLiability(accountName: string): OpeningBalanceRefusal {
  return {
    code: "not_asset_or_liability",
    error: `${accountName} isn't an asset or a liability, so it takes no opening balance.`,
  };
}

function notRecorded(
  accountName: string,
  action: "change" | "remove",
): OpeningBalanceRefusal {
  return {
    code: "not_recorded",
    error: `${accountName} has no opening balance to ${action}.`,
  };
}

function locked(outcome: {
  accountName: string;
  lock: OpeningLock;
  journalId: number;
}): OpeningBalanceRefusal {
  const { accountName, journalId } = outcome;
  return outcome.lock === "has_entries"
    ? {
        code: "account_has_entries",
        error: `${accountName} has other transactions. Change its opening balance in its journal entry.`,
        journal_id: journalId,
      }
    : {
        code: "opening_entry_shared",
        error: `${accountName}'s opening balance shares a journal entry with other accounts. Change it there.`,
        journal_id: journalId,
      };
}

function dateNotBeforeFirstActivity(outcome: {
  accountName: string;
  firstActivityDate: string;
}): OpeningBalanceRefusal {
  return {
    code: "date_not_before_first_activity",
    error: `Pick a day before ${outcome.firstActivityDate}, ${outcome.accountName}'s first transaction.`,
    first_activity_date: outcome.firstActivityDate,
  };
}
