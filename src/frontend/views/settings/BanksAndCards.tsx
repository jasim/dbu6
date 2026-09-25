import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Checkbox } from "@sapporta/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@sapporta/ui/tooltip";
import { usePageTitle } from "@sapporta/frontend/shell";
import type {
  StatementAccountChange,
  StatementAccountRow,
} from "../../../shared/index";
import { ADD_ROUTE } from "../../add-account/state";
import { apiErrorMessage, setupApi } from "../../api";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { StatusChip } from "../../components/status-chip";
import { Button } from "../../components/ui/button";
import { maskIdentifier } from "../../format";
import { refreshSetup, statementAccountsQuery } from "../../queries";
import { RowMenu } from "./RowMenu";
import { StatementAccountDialog } from "./StatementAccountDialog";

/*
 * Settings' Banks & cards: the banks and cards statements come from, one
 * row each, in one table. A row is edited or removed only while nothing of
 * its own is posted or drafted on its account; its opening entry doesn't
 * count, and removing the row deletes an opening entry that opens it alone.
 * One whose account was deleted from the books can still be removed, which
 * stops dbu6 importing its statements.
 * A new bank or card comes in from its statements, at /add.
 */

/**
 * Why a row can't change: entries in the books, or only transactions still
 * to review, which go once deleted in Review. Null while it can.
 */
function lockedBecause(
  row: Pick<StatementAccountRow, "entries" | "drafts">,
): string | null {
  if (row.entries > 0) return "Has transactions, so it can't change here.";
  if (row.drafts > 0) {
    return "Has transactions to review. Delete them in Review to change it.";
  }
  return null;
}

export function BanksAndCards() {
  usePageTitle("Banks & cards");
  const client = useQueryClient();
  const query = useQuery(statementAccountsQuery);
  const [editing, setEditing] = useState<StatementAccountRow | null>(null);
  const [removing, setRemoving] = useState<StatementAccountRow | null>(null);

  const save = async (change: StatementAccountChange) => {
    const accounts = await setupApi.changeStatementAccount({ body: change });
    client.setQueryData(statementAccountsQuery.queryKey, accounts);
    await refreshSetup(client);
  };
  const addLink = (
    <Link
      to={ADD_ROUTE}
      className="text-primary underline-offset-4 hover:underline"
    >
      Add a bank or card
    </Link>
  );

  const data = query.data;
  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Banks & cards">
          <p>The accounts your statements come from.</p>
        </ScreenTitle>
      }
    >
      <div className="mt-6">
        {query.isPending && (
          <p className="text-body text-ink-meta">
            Loading your banks and cards…
          </p>
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
                title="No banks or cards yet"
                body="Each comes in from its statements."
                action={
                  <Button
                    render={<Link to={ADD_ROUTE} />}
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                  >
                    Add a bank or card
                  </Button>
                }
              />
            ) : (
              <>
                <AccountsTable
                  rows={data.accounts}
                  onEdit={setEditing}
                  onRemove={setRemoving}
                />
                <p className="mt-4 text-body text-ink-soft">
                  {addLink} from its statements.
                </p>
              </>
            )}
            <StatementAccountDialog
              row={editing}
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
      </div>
    </Screen>
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
  const locked = lockedBecause(row);
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
        {locked !== null ? (
          <Tooltip>
            <TooltipTrigger
              delay={0}
              aria-label={locked}
              className="inline-flex h-sap-ctl w-[var(--height-sap-ctl)] items-center justify-center rounded-control text-ink-meta outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4"
            >
              <Lock />
            </TooltipTrigger>
            <TooltipContent side="left">{locked}</TooltipContent>
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
                {!row.in_ledger
                  ? "dbu6 stops importing its statements."
                  : deleteAccount
                    ? "dbu6 stops importing its statements, and deletes the account and its opening balance."
                    : "dbu6 stops importing its statements. The account and its opening balance stay in your chart."}
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
