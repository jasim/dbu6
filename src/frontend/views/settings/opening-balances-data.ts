import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import type {
  OpeningBalanceAccount,
  OpeningBalances,
} from "../../../shared/index";
import { openingBalancesApi, removeAccount } from "../../api";
import { openingBalancesQuery, refreshSetup } from "../../queries";
import type { BalanceEntry } from "./OpeningBalanceDialog";

/*
 * Opening balances' one read and four writes: the balances the page lists,
 * recording, changing and removing one, and removing an account the user
 * doesn't have.
 */

/**
 * What the page hands the balance form's route: the list it read, so the form
 * opens the account from the very list behind it, and the one write a form
 * makes. Removing is the list's own: the form only asks for it.
 */
export interface OpeningBalancesPage {
  data: OpeningBalances;
  save: (account: OpeningBalanceAccount, entry: BalanceEntry) => Promise<void>;
  /** Closes the form and asks the list to remove the account's balance. */
  askRemove: (account: OpeningBalanceAccount) => void;
}

export function useOpeningBalances() {
  const client = useQueryClient();
  const query = useQuery(openingBalancesQuery);

  // A failure may mean the list is out of date: read it again.
  const afterFailure = (error: unknown): never => {
    void query.refetch();
    throw error;
  };
  const save = async (account: OpeningBalanceAccount, entry: BalanceEntry) => {
    await (
      account.opening === null
        ? openingBalancesApi.record({
            body: { account_id: account.account_id, ...entry },
          })
        : openingBalancesApi.change({
            params: { accountId: account.account_id },
            body: entry,
          })
    ).catch(afterFailure);
    await refreshSetup(client);
  };
  const remove = async (account: OpeningBalanceAccount) => {
    await openingBalancesApi
      .remove({ params: { accountId: account.account_id }, body: {} })
      .catch(afterFailure);
    await refreshSetup(client);
  };

  // "I don't have this": the account goes, through the Accounts page's
  // delete, which refuses one anything is on.
  const removeUnheld = async (account: OpeningBalanceAccount) => {
    await removeAccount(account.account_id).catch(afterFailure);
    await refreshSetup(client);
  };

  return { query, save, remove, removeUnheld };
}

/**
 * The list the page read, as its balance form's route reads it. The form is a
 * child of the page, mounted only once the list is here, so it looks its
 * account up in that list instead of reading the same one again behind it.
 */
export function useOpeningBalancesPage(): OpeningBalancesPage {
  return useOutletContext<OpeningBalancesPage>();
}
