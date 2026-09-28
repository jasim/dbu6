import { useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  StatementAccountChange,
  StatementAccounts,
} from "../../../shared/index";
import { setupApi } from "../../api";
import { refreshSetup, statementAccountsQuery } from "../../queries";

/*
 * Banks & cards' one read and one write: the statements' accounts, and the
 * change that edits or removes one.
 */

/**
 * What the page hands the routes under it: the list it read, so a form opens
 * the row from the very list behind it, and the one write.
 */
export interface StatementAccountsPage {
  data: StatementAccounts;
  save: (change: StatementAccountChange) => Promise<void>;
}

export function useStatementAccounts() {
  const client = useQueryClient();
  const query = useQuery(statementAccountsQuery);
  const save = useCallback(
    async (change: StatementAccountChange) => {
      const accounts = await setupApi.changeStatementAccount({ body: change });
      // The server answers with the list as it now stands, so the page shows
      // the change before any refetch lands.
      client.setQueryData(statementAccountsQuery.queryKey, accounts);
      await refreshSetup(client);
    },
    [client],
  );
  return { query, save };
}

/**
 * The list the page read, as its edit form's route reads it. The form is a
 * child of the page, mounted only once the list is here, so it looks its row
 * up in that list instead of reading the same one again behind it.
 */
export function useStatementAccountsPage(): StatementAccountsPage {
  return useOutletContext<StatementAccountsPage>();
}
