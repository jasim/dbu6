import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@sapporta/shared/client";
import { apiErrorMessage } from "../../api";
import { DialogNotice } from "../../components/dialog-notice";
import { useFormClose } from "../../form-route";
import { accountQuery } from "../../queries";
import { parseRowId } from "../../row-id";
import { AccountDialog } from "./AccountDialog";
import { accountRow } from "./account-form";
import { ACCOUNTS_ROUTE } from "./routes";

/*
 * The chart's two forms as routes: /accounts/new, and /accounts/:accountId/edit
 * for one account. The chart is their parent route, so it stays on screen
 * behind them, and a link to a form opens the chart it belongs to rather than
 * a dialog over nothing.
 *
 * Neither form takes its account from the grid row that opened it: the URL's
 * id is the whole input, so a pasted link and a click land in the same place.
 * The account is one row read from the table API, which works for any id —
 * the chart's own page of rows stops at a thousand accounts.
 */

/** The new-account form. */
export function NewAccountDialog() {
  return <AccountDialog editing="new" onClose={useFormClose(ACCOUNTS_ROUTE)} />;
}

/** One account's edit form, by the id in the URL. */
export function EditAccountDialog() {
  const back = useFormClose(ACCOUNTS_ROUTE);
  const id = parseRowId(useParams().accountId);
  // `id ?? 0` only keeps the hook's argument a number: the read is off when
  // the link names no account, and the notice below is what shows.
  const record = useQuery({ ...accountQuery(id ?? 0), enabled: id !== null });

  if (id === null) {
    return (
      <DialogNotice
        title="No account in this link"
        message="An account's form is at /accounts/<number>/edit. This link's number is missing or not a number."
        onClose={back}
      />
    );
  }
  if (record.isPending) {
    return <DialogNotice title="Loading the account…" onClose={back} />;
  }
  const account = record.data === undefined ? null : accountRow(record.data);
  if (account === null) {
    const gone =
      record.isError &&
      record.error instanceof ApiError &&
      record.error.status === 404;
    return (
      <DialogNotice
        title={
          gone
            ? "That account isn't in your books"
            : "Couldn't load the account"
        }
        message={
          gone
            ? "It has been deleted since this link was made. Your chart is behind this."
            : record.isError
              ? apiErrorMessage(record.error)
              : "The server sent a row this form doesn't read as an account."
        }
        onRetry={gone ? undefined : () => void record.refetch()}
        onClose={back}
      />
    );
  }
  return <AccountDialog editing={account} onClose={back} />;
}
