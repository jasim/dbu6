import { useParams } from "react-router-dom";
import { DialogNotice } from "../../components/dialog-notice";
import { useFormClose } from "../../form-route";
import { parseRowId } from "../../row-id";
import { formSectionOf } from "../../opening-balances";
import { OpeningBalanceDialog } from "./OpeningBalanceDialog";
import { useOpeningBalancesPage } from "./opening-balances-data";
import { BALANCES_SETTINGS_ROUTE } from "./routes";

/*
 * One account's opening balance as the URL
 * `/settings/balances/:accountId/edit`: recording it when the account has
 * none, changing it when it has. The list is the parent route, so it stays
 * on screen behind the form and a link to the form opens the page it
 * belongs to.
 *
 * The account comes from the list that page read, so a deep link costs no
 * request of its own. The table it belongs in — what you own, what you owe,
 * or a bank's own — is the list's own answer for it, so the form says the
 * same thing whichever way it was reached. The page reads the list before
 * this route is mounted at all, so what is left to answer for here is the
 * link, not the read.
 */

export function EditOpeningBalanceDialog() {
  const { data, save } = useOpeningBalancesPage();
  const id = parseRowId(useParams().accountId);
  const close = useFormClose(BALANCES_SETTINGS_ROUTE);

  if (id === null) {
    return (
      <DialogNotice
        title="No account in this link"
        message="A balance's form is at /settings/balances/<number>/edit, where the number identifies the account."
        onClose={close}
      />
    );
  }
  const account = data.accounts.find((one) => one.account_id === id) ?? null;
  if (account === null) {
    return (
      <DialogNotice
        title="That account isn't in your balances"
        message="Your chart has changed since this link was made. The list is behind this."
        onClose={close}
      />
    );
  }
  const section = formSectionOf(account);
  return (
    <OpeningBalanceDialog
      editing={{ account, section }}
      save={save}
      onClose={close}
    />
  );
}
