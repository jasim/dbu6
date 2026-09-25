import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { Lock, MoreHorizontal } from "lucide-react";
import { Checkbox } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import { comboboxClassNames } from "@sapporta/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@sapporta/ui/tooltip";
import type {
  AccountKind,
  StatementAccountChange,
  StatementAccountRow,
} from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { StatusChip } from "../components/status-chip";
import { Button } from "../components/ui/button";
import { maskIdentifier } from "../format";
import { refreshSetup, statementAccountsQuery } from "../queries";
import { SetupFrame, StepHeading } from "./SetupWizard";
import {
  StatementAccountDialog,
  type StatementAccountEditing,
} from "./StatementAccountDialog";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 2, the banks and cards statements come from: one row each, in one
 * table. Rows can be added at any time, in new books or old ones; a row is
 * edited or removed only while nothing is posted or drafted on its account.
 */

const LOCKED = "Has transactions. Change it on the Accounts page.";

export function BanksStep() {
  const client = useQueryClient();
  const query = useQuery(statementAccountsQuery);
  const [editing, setEditing] = useState<StatementAccountEditing | null>(null);
  const [removing, setRemoving] = useState<StatementAccountRow | null>(null);

  const save = async (change: StatementAccountChange) => {
    const accounts = await setupApi.changeStatementAccount({ body: change });
    client.setQueryData(statementAccountsQuery.queryKey, accounts);
    await refreshSetup(client);
  };
  const add = (kind: AccountKind) => setEditing({ mode: "add", kind });

  const data = query.data;
  return (
    <SetupFrame step="banks">
      <StepHeading title="Add your banks and cards">
        Every account you get a statement for. Its transactions come in from
        there.
      </StepHeading>
      {query.isPending && (
        <p className="text-body text-ink-meta">Loading your banks and cards…</p>
      )}
      {query.isError && (
        <LoadError
          title="Couldn't load your banks and cards"
          message={apiErrorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      )}
      {data && (
        <>
          {data.accounts.length === 0 ? (
            <EmptyState
              title="Add the accounts you get statements for"
              body="Savings, current and credit card accounts."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => add("bank")}>+ Bank account</Button>
                  <Button variant="outline" onClick={() => add("card")}>
                    + Credit card
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <AccountsTable
                rows={data.accounts}
                onEdit={(row) => setEditing({ mode: "edit", row })}
                onRemove={setRemoving}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => add("bank")}>
                  + Bank account
                </Button>
                <Button variant="outline" onClick={() => add("card")}>
                  + Credit card
                </Button>
              </div>
            </>
          )}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <Button
              render={<Link to={SETUP_STEP_ROUTES.review} />}
              nativeButton={false}
              variant="ghost"
            >
              Skip for now
            </Button>
            {data.accounts.length > 0 && (
              <Button
                render={<Link to={SETUP_STEP_ROUTES.statements} />}
                nativeButton={false}
              >
                Next: First statements
              </Button>
            )}
          </div>
          <StatementAccountDialog
            editing={editing}
            data={data}
            save={save}
            onClose={() => setEditing(null)}
          />
          <RemoveDialog
            row={removing}
            remove={(row, deleteAccount) =>
              save({
                action: "remove",
                account_id: row.account_id,
                delete_account: deleteAccount,
              })
            }
            onClose={() => setRemoving(null)}
          />
        </>
      )}
    </SetupFrame>
  );
}

function AccountsTable({
  rows,
  onEdit,
  onRemove,
}: {
  rows: readonly StatementAccountRow[];
  onEdit: (row: StatementAccountRow) => void;
  onRemove: (row: StatementAccountRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-sap-border bg-card shadow-card">
      <table className="w-full text-row">
        <thead className="text-left text-meta text-ink-meta">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">
              Account
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 font-medium sm:table-cell"
            >
              Type
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 font-medium sm:table-cell"
            >
              Bank
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Number
            </th>
            <th scope="col" className="py-2.5 pl-3 pr-4">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <AccountRow
              key={row.account_id}
              row={row}
              onEdit={() => onEdit(row)}
              onRemove={() => onRemove(row)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({
  row,
  onEdit,
  onRemove,
}: {
  row: StatementAccountRow;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const locked = row.entries + row.drafts > 0;
  const number = row.account_identifiers[0];
  const kind = row.kind === "card" ? "Credit card" : "Bank account";
  return (
    <tr className="border-t border-line-inner">
      <td className="py-2.5 pl-5 pr-3 align-middle">
        <div className="font-semibold text-foreground">{row.name}</div>
        {/* On a phone, the columns it drops. */}
        <div className="text-meta text-ink-meta sm:hidden">
          {kind} · {row.institution}
        </div>
        {!row.in_ledger && (
          <StatusChip tone="problem" className="mt-0.5">
            Deleted from your books
          </StatusChip>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-ink-soft sm:table-cell">
        {kind}
      </td>
      <td className="hidden px-3 py-2.5 text-ink-soft sm:table-cell">
        {row.institution}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {number === undefined ? (
          <span className="text-ink-meta">— from statement</span>
        ) : (
          <span className="tnum font-mono">{maskIdentifier(number)}</span>
        )}
      </td>
      <td className="py-1.5 pl-3 pr-4 text-right">
        {locked ? (
          <Tooltip>
            <TooltipTrigger
              delay={0}
              aria-label={LOCKED}
              className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-meta outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4"
            >
              <Lock />
            </TooltipTrigger>
            <TooltipContent side="left">{LOCKED}</TooltipContent>
          </Tooltip>
        ) : (
          <RowMenu
            name={row.name}
            onEdit={row.in_ledger ? onEdit : null}
            onRemove={onRemove}
          />
        )}
      </td>
    </tr>
  );
}

/** A row's "⋯" menu: Edit (while its account is in the books) and Remove. */
function RowMenu({
  name,
  onEdit,
  onRemove,
}: {
  name: string;
  onEdit: (() => void) | null;
  onRemove: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Actions for ${name}`}
        className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-soft outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 data-popup-open:bg-muted [&_svg]:size-4"
      >
        <MoreHorizontal />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className={comboboxClassNames.positioner}
          align="end"
          sideOffset={4}
        >
          <Menu.Popup
            className={cn(comboboxClassNames.popup, "w-auto min-w-32 p-1")}
          >
            {onEdit && (
              <Menu.Item className={comboboxClassNames.item} onClick={onEdit}>
                Edit
              </Menu.Item>
            )}
            <Menu.Item className={comboboxClassNames.item} onClick={onRemove}>
              Remove
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function RemoveDialog({
  row,
  remove,
  onClose,
}: {
  row: StatementAccountRow | null;
  remove: (row: StatementAccountRow, deleteAccount: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [deleteAccount, setDeleteAccount] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setProblem(null);
    setDeleteAccount(true);
    onClose();
  };

  async function confirm() {
    if (row === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await remove(row, deleteAccount && row.in_ledger);
      close();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>Remove {row.name}?</DialogTitle>
              <DialogDescription>
                dbu6 stops importing its statements.
              </DialogDescription>
            </DialogHeader>
            {row.in_ledger && (
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-body text-foreground">
                <Checkbox
                  className="mt-0.5"
                  checked={deleteAccount}
                  onCheckedChange={(checked) => setDeleteAccount(checked)}
                />
                Also delete it from your chart of accounts
              </label>
            )}
            {problem && (
              <p role="alert" className="mt-3 text-body text-destructive">
                {problem}
              </p>
            )}
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => void confirm()}
              >
                {saving ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
