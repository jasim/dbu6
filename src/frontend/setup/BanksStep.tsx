import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@sapporta/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import type {
  StatementAccountChange,
  StatementAccountRow,
  StatementAccounts,
} from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { StatusChip } from "../components/status-chip";
import { Button } from "../components/ui/button";
import { plural } from "../format";
import { refreshSetup, statementAccountsQuery } from "../queries";
import { OPENING_BALANCES_ROUTE } from "../views/opening-balances/OpeningBalances";
import { SetupFrame, StepHeading } from "./SetupWizard";
import {
  StatementAccountDialog,
  type StatementAccountEditing,
} from "./StatementAccountDialog";
import { SETUP_STEP_ROUTES } from "./steps";

/*
 * Step 2, the banks and cards statements come from: one row each, grouped by
 * institution. Rows can be added at any time, in new books or old ones; a
 * row changes or goes only while nothing is posted or drafted on its
 * account.
 */
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

  const data = query.data;
  return (
    <SetupFrame step="banks">
      <StepHeading title="Your banks and cards">
        Each bank account and card you get statements from, as an account in
        your books. A row can be changed until its first transaction.
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Button
              variant={data.accounts.length === 0 ? "default" : "outline"}
              onClick={() => setEditing({ mode: "add" })}
            >
              Add a bank or card
            </Button>
            {data.accounts.length > 0 && (
              <Button
                render={<Link to={SETUP_STEP_ROUTES.statements} />}
                nativeButton={false}
              >
                Next: statement formats
              </Button>
            )}
          </div>
          {data.accounts.length === 0 ? (
            <EmptyState
              title="Add the banks and cards you get statements from"
              body="Each becomes an account in your books, and the next step shows dbu6 one of its statements."
              action={
                <Button
                  render={<Link to={OPENING_BALANCES_ROUTE} />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                >
                  Skip for now
                </Button>
              }
            />
          ) : (
            <InstitutionList
              data={data}
              onEdit={(row) => setEditing({ mode: "edit", row })}
              onRemove={setRemoving}
            />
          )}
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

function InstitutionList({
  data,
  onEdit,
  onRemove,
}: {
  data: StatementAccounts;
  onEdit: (row: StatementAccountRow) => void;
  onRemove: (row: StatementAccountRow) => void;
}) {
  const institutions = data.institutions.filter((institution) =>
    data.accounts.some((row) => row.institution === institution.name),
  );
  return (
    <div className="space-y-4">
      {institutions.map((institution) => (
        <section
          key={institution.name}
          className="rounded-card border border-sap-border bg-card shadow-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-4">
            <h3 className="text-subheading text-foreground">
              {institution.name}
            </h3>
            <span className="text-meta text-ink-meta">
              {institution.parsers.length > 0
                ? "Its statements can be read"
                : "No statement format yet"}
            </span>
          </div>
          <ul>
            {data.accounts
              .filter((row) => row.institution === institution.name)
              .map((row) => (
                <AccountRow
                  key={row.account_id}
                  row={row}
                  onEdit={() => onEdit(row)}
                  onRemove={() => onRemove(row)}
                />
              ))}
          </ul>
        </section>
      ))}
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
  const activity = [
    row.entries > 0 ? plural(row.entries, "entry", "entries") : null,
    row.drafts > 0 ? plural(row.drafts, "draft") : null,
  ].filter((part): part is string => part !== null);
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-inner px-4 py-3">
      <div className="min-w-0 flex-1 basis-[220px]">
        <div className="font-semibold text-foreground">{row.name}</div>
        <div className="mt-0.5 text-meta text-ink-meta">
          {row.kind === "card" ? "Card" : "Bank account"}
          {row.parent ? ` under ${row.parent.name}` : ""}
          {" · "}
          {row.account_identifiers.length > 0 ? (
            <span className="tnum font-mono">
              {row.account_identifiers.join(", ")}
            </span>
          ) : (
            "no number yet"
          )}
        </div>
      </div>
      <div className="text-meta">
        {!row.in_ledger ? (
          <StatusChip tone="problem">Deleted from your books</StatusChip>
        ) : locked ? (
          <StatusChip tone="waiting">{activity.join(", ")}</StatusChip>
        ) : (
          <StatusChip tone="waiting">No transactions yet</StatusChip>
        )}
      </div>
      <div className="flex gap-1">
        {locked ? (
          <span className="text-meta text-ink-meta">
            Change it on the{" "}
            <Link
              to="/accounts"
              className="text-primary underline-offset-4 hover:underline"
            >
              Accounts page
            </Link>
          </span>
        ) : (
          <>
            {row.in_ledger && (
              <Button variant="ghost" size="sm" onClick={onEdit}>
                Change
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </>
        )}
      </div>
    </li>
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

  async function confirm() {
    if (row === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await remove(row, deleteAccount && row.in_ledger);
      onClose();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (open) return;
        setProblem(null);
        setDeleteAccount(true);
        onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>Remove {row.name}?</DialogTitle>
              <DialogDescription>
                Its statements will no longer be set up for importing.
              </DialogDescription>
            </DialogHeader>
            {row.in_ledger && (
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-body text-foreground">
                <Checkbox
                  className="mt-0.5"
                  checked={deleteAccount}
                  onCheckedChange={(checked) => setDeleteAccount(checked)}
                />
                Also delete the account {row.name} from your books. It has no
                transactions.
              </label>
            )}
            {problem && (
              <p role="alert" className="mt-3 text-body text-destructive">
                {problem}
              </p>
            )}
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={onClose}>
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
