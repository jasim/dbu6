import type {
  OpeningBalanceAccount,
  OpeningBalances,
} from "../../../shared/index";
import { balanceSections } from "../../opening-balances";
import { ADD_OTHER_ROUTE } from "../state";

/*
 * /add/other (PLAN.md card 6 and C1): the balance of an account no
 * statement comes from, such as cash, a deposit or a loan. The card is a
 * function of the URL alone:
 *
 *   ?run=setup                → Anything else? (card 6), first run only
 *   ?run=setup&record=1       → C1, which comes back to card 6
 *   no ?run=setup             → C1, from Home's + Add; then Home
 *
 * What card 6 says has been recorded comes from the books, not the URL.
 *
 * C1 records a balance; it makes no accounts. The account comes from the
 * chart, and one the chart lacks is added on the Accounts page first.
 */

export interface OtherUrl {
  /** `?run=setup`: the first run, from card 5's "That's all". */
  setup: boolean;
  /** `?record=1`: C1 on the first run, from card 6's "Add one". */
  record: boolean;
}

export function readOtherUrl(params: URLSearchParams): OtherUrl {
  return {
    setup: params.get("run") === "setup",
    record: params.get("record") === "1",
  };
}

/** /add/other in the state `url` names. */
export function otherHref(url: Partial<OtherUrl>): string {
  const params = new URLSearchParams();
  if (url.setup) params.set("run", "setup");
  if (url.record) params.set("record", "1");
  const text = params.toString();
  return text === "" ? ADD_OTHER_ROUTE : `${ADD_OTHER_ROUTE}?${text}`;
}

export type OtherCard = "anything-else" | "record";

export function otherCard(url: OtherUrl): OtherCard {
  return url.setup && !url.record ? "anything-else" : "record";
}

/** Where C1 goes once the balance is recorded. */
export function afterRecording(url: OtherUrl): string {
  return url.setup ? otherHref({ setup: true }) : "/";
}

/**
 * The accounts C1 offers: what the user owns or owes outside the banks and
 * cards (whose first statements set their balance), with no opening yet,
 * in tree order, what they own first.
 */
export function unrecorded(data: OpeningBalances): OpeningBalanceAccount[] {
  // An empty group such as "Credit Cards" is listed too: nothing in the
  // books tells a group waiting for accounts from one that holds money.
  return otherAccounts(data).filter((account) => account.opening === null);
}

/**
 * What card 6 says is recorded: the own and owe accounts that have an
 * opening, in the same order, whenever it was recorded.
 */
export function recordedNames(data: OpeningBalances): string[] {
  return otherAccounts(data)
    .filter((account) => account.opening !== null)
    .map((account) => account.name);
}

/** The own and owe accounts, in tree order: no bank or card. */
function otherAccounts(data: OpeningBalances): OpeningBalanceAccount[] {
  return balanceSections(data, null)
    .filter((one) => one.section !== "statement")
    .flatMap((one) => one.accounts);
}

/** C1 with nothing to offer: every such account has one, or there is none. */
export function nothingLeftTitle(data: OpeningBalances): string {
  const any = data.accounts.some(
    (account) => account.section === "own" || account.section === "owe",
  );
  return any
    ? "Every account in your chart has its balance"
    : "Your chart has no cash, deposit or loan accounts";
}

/** C1's question, once the account is picked. */
export function recordTitle(
  account: Pick<OpeningBalanceAccount, "name" | "account_type"> | null,
): string {
  if (account === null) return "Which account?";
  return account.account_type === "Liability"
    ? `What did you owe on ${account.name}?`
    : `What did ${account.name} hold?`;
}
