import type { OpeningBalanceAccount, OpeningBalances } from "../shared/index";

/*
 * Tests only: an Opening balances answer from its accounts, with the check
 * as the server lists it for them, every account a table lists with no
 * opening, unless the test says which.
 */
export function balancesOf(
  accounts: OpeningBalanceAccount[],
  more: {
    equity_account?: OpeningBalances["equity_account"];
    unanswered?: OpeningBalanceAccount[];
    wrong_side?: OpeningBalances["wrong_side"];
  } = {},
): OpeningBalances {
  const unanswered =
    more.unanswered ??
    accounts.filter(
      (account) => account.opening === null && account.section !== null,
    );
  return {
    equity_account: more.equity_account ?? null,
    accounts,
    unanswered: unanswered.map(({ account_id, name, path, account_type }) => ({
      account_id,
      name,
      path,
      account_type,
    })),
    wrong_side: more.wrong_side ?? [],
  };
}
