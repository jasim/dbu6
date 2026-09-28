import { useParams } from "react-router-dom";
import { DialogNotice } from "../../components/dialog-notice";
import { useFormClose } from "../../form-route";
import { parseRowId } from "../../row-id";
import { BANKS_SETTINGS_ROUTE } from "./routes";
import { StatementAccountDialog } from "./StatementAccountDialog";
import { lockedBecause } from "./statement-account-form";
import { useStatementAccountsPage } from "./statement-accounts";

/*
 * One bank or card's edit form as the URL `/settings/banks/:accountId/edit`.
 * The list is its parent route, so it stays on screen behind the form and a
 * link to the form opens the page it belongs to.
 *
 * The row comes from the list that page read, by the id in the URL: the list
 * carries everything the form needs — the row, the banks and the parent
 * groupings — so a deep link costs no request of its own. The page reads the
 * list before this route is mounted at all, so the states left to answer for
 * here are the link's, not the read's.
 */

export function EditStatementAccountDialog() {
  const { data, save } = useStatementAccountsPage();
  const id = parseRowId(useParams().accountId);
  const close = useFormClose(BANKS_SETTINGS_ROUTE);

  if (id === null) {
    return (
      <DialogNotice
        title="No bank or card in this link"
        message="Its form is at /settings/banks/<number>/edit, where the number identifies the account in your books."
        onClose={close}
      />
    );
  }
  const row = data.accounts.find((one) => one.account_id === id) ?? null;
  if (row === null) {
    return (
      <DialogNotice
        title="That bank or card isn't in your settings"
        message="It has been removed since this link was made. The list is behind this."
        onClose={close}
      />
    );
  }
  const locked = lockedBecause(row);
  if (locked !== null) {
    return (
      <DialogNotice
        title={`${row.name} can't change here`}
        message={locked}
        onClose={close}
      />
    );
  }
  if (!row.in_ledger) {
    return (
      <DialogNotice
        title={`${row.name} is deleted from your books`}
        message="Its statements are no longer imported. Remove it from the list to finish."
        onClose={close}
      />
    );
  }
  return (
    <StatementAccountDialog row={row} data={data} save={save} onClose={close} />
  );
}
