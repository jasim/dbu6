import type {
  OpeningBalances,
  StatementAccounts,
  TransactionMappingsView,
} from "../../../shared/index";
import { plural } from "../../format";
import type { StatusCell } from "./describeCodingAgent";

/*
 * What Settings' index shows in its value column for each page under it: how
 * much each holds, so the index says whether the books are set up without
 * opening a page.
 */

export function banksValue(data: StatementAccounts): StatusCell {
  const count = data.accounts.length;
  return count === 0
    ? { tone: "quiet", text: "None yet" }
    : { tone: "plain", text: plural(count, "account") };
}

/**
 * How many accounts have an opening balance. Balances are optional, so the
 * count of accounts without one isn't shown: it isn't work left to do.
 */
export function balancesValue(data: OpeningBalances): StatusCell {
  const recorded = data.accounts.filter((account) => account.opening !== null);
  return recorded.length === 0
    ? { tone: "quiet", text: "None yet" }
    : { tone: "plain", text: `${recorded.length} recorded` };
}

export function rulesValue(data: TransactionMappingsView): StatusCell {
  if (data.state === "unreadable") {
    return { tone: "attention", text: `${data.filename} can't be read` };
  }
  const count = data.exact.length + data.contains.length;
  return count === 0
    ? { tone: "quiet", text: "None yet" }
    : { tone: "plain", text: plural(count, "rule") };
}
