import type { OpeningBalanceAccount, OpeningBalances } from "../shared/index";

/*
 * Tests only: an Opening balances answer from its accounts. The check's
 * lists are the server's to decide, so a test names the accounts on them;
 * left out, they are empty.
 */
export function balancesOf(
  accounts: OpeningBalanceAccount[],
  more: {
    equity_account?: OpeningBalances["equity_account"];
    unanswered?: OpeningBalanceAccount[];
    empty_groups?: OpeningBalanceAccount[];
    wrong_side?: OpeningBalances["wrong_side"];
  } = {},
): OpeningBalances {
  const ref = ({
    account_id,
    name,
    path,
    account_type,
  }: OpeningBalanceAccount) => ({ account_id, name, path, account_type });
  return {
    equity_account: more.equity_account ?? null,
    accounts,
    unanswered: (more.unanswered ?? []).map(ref),
    empty_groups: (more.empty_groups ?? []).map(ref),
    wrong_side: more.wrong_side ?? [],
  };
}
