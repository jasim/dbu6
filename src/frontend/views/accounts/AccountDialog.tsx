import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Lock } from "lucide-react";
import { Input } from "@sapporta/ui";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { createTableRow } from "@sapporta/frontend";
import {
  LEDGER_ACCOUNT_TYPES,
  type LedgerAccountType,
} from "../../../shared/index";
import { ACCOUNT_TYPE_TERMS } from "../../account-type-terms";
import { accountsApi, apiErrorMessage, removeAccount } from "../../api";
import { AccountCombobox } from "../../components/account-pickers";
import { Button } from "../../components/ui/button";
import {
  accountChartQuery,
  accountHasEntriesQuery,
  importPresetsQuery,
  refreshAccounts,
} from "../../queries";
import { BANKS_SETTINGS_ROUTE } from "../settings/routes";
import {
  NEW_ACCOUNT_DRAFT,
  accountRow,
  deleteBlockers,
  draftOf,
  moveNotice,
  nameLocked,
  parentChoices,
  readDraft,
  refusalField,
  typeLock,
  withType,
  type AccountDraft,
  type AccountFormContext,
  type AccountFormField,
  type AccountRow,
} from "./account-form";

/*
 * One account's name, type and parent, in one form. The grid is read-only,
 * so every change of an existing account comes through here and goes to
 * `PUT /api/accounts/:id`, which writes the three together and takes the
 * account's whole branch with it when the type changes. A new account is one
 * INSERT on the table API, where the triggers already see its type and
 * parent together.
 *
 * The form says what it can see for itself: a taken name, a parent that
 * doesn't fit, and what a delete is standing on. What only the server knows —
 * posted entries and drafts — comes back as a refusal, on the field it names.
 */

type Editing = AccountRow | "new";

export function AccountDialog({
  editing,
  onClose,
}: {
  /** The account being edited: "new", or the one it is. */
  editing: Editing;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogBody
          key={editing === "new" ? "new" : editing.id}
          account={editing === "new" ? null : editing}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  account,
  onClose,
}: {
  account: AccountRow | null;
  onClose: () => void;
}) {
  const ids = {
    name: useId(),
    type: useId(),
    parent: useId(),
  };
  const client = useQueryClient();
  const chartQuery = useQuery(accountChartQuery);
  const presetsQuery = useQuery(importPresetsQuery);
  const entriesQuery = useQuery({
    ...accountHasEntriesQuery(account?.id ?? 0),
    enabled: account !== null,
  });

  const [draft, setDraft] = useState<AccountDraft>(() =>
    account === null ? { ...NEW_ACCOUNT_DRAFT } : draftOf(account),
  );
  const [problem, setProblem] = useState<{
    message: string;
    field: AccountFormField | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  // "none" while the form is being filled in; "confirm" while the delete is
  // being confirmed; "blocked" when the form already knows what is in the way.
  const [deleting, setDeleting] = useState<"none" | "confirm" | "blocked">(
    "none",
  );

  const context = useMemo<AccountFormContext>(() => {
    const chart = (chartQuery.data ?? [])
      .map(accountRow)
      .filter((one): one is AccountRow => one !== null);
    const statementAccounts = new Set(
      (presetsQuery.data?.institutions ?? []).flatMap((institution) =>
        institution.accounts.map((preset) => preset.account_id),
      ),
    );
    return { chart, statementAccounts };
  }, [chartQuery.data, presetsQuery.data]);
  const ready = chartQuery.isSuccess && presetsQuery.isSuccess;

  const set = (patch: Partial<AccountDraft>) => {
    setProblem(null);
    setDraft({ ...draft, ...patch });
  };
  const lock =
    account === null ? { locked: false as const } : typeLock(account, context);
  const choices = parentChoices(
    context.chart,
    draft.account_type,
    account?.id ?? null,
  );
  const notice =
    account === null
      ? null
      : moveNotice({
          account,
          chart: context.chart,
          account_type: draft.account_type,
          hasEntries: entriesQuery.data === true,
        });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const reading = readDraft(draft, account, context);
    if (!reading.ok) {
      setProblem({ message: reading.problem, field: reading.field });
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      const body = {
        name: reading.draft.name,
        account_type: reading.draft.account_type,
        parent_id: reading.draft.parent_id,
      };
      if (account === null) {
        await createTableRow("accounts", body);
      } else {
        await accountsApi.changeAccount({ params: { id: account.id }, body });
      }
      await refreshAccounts(client);
      onClose();
    } catch (error) {
      setProblem({
        message: apiErrorMessage(error),
        field: refusalField(error),
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (account === null) return;
    setProblem(null);
    setSaving(true);
    try {
      await removeAccount(account.id);
      await refreshAccounts(client);
      onClose();
    } catch (error) {
      setDeleting("none");
      setProblem({ message: apiErrorMessage(error), field: null });
    } finally {
      setSaving(false);
    }
  }

  const blockers = account === null ? [] : deleteBlockers(account, context);

  return (
    <form onSubmit={save} noValidate>
      <DialogHeader>
        <DialogTitle>
          {account === null ? "New account" : `Edit ${account.name}`}
        </DialogTitle>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <Field label="Name" htmlFor={ids.name}>
          {account !== null && nameLocked(account) ? (
            <p className="text-row text-ink-meta">
              <Lock aria-hidden="true" className="mr-1 inline size-3.5" />
              {account.name} is found by its name, so it can&rsquo;t change.
            </p>
          ) : (
            <Input
              id={ids.name}
              value={draft.name}
              maxLength={120}
              aria-invalid={problem?.field === "name" || undefined}
              onChange={(event) => set({ name: event.target.value })}
              disabled={!ready}
              className="h-sap-ctl w-full rounded-control"
            />
          )}
        </Field>

        <Field label="Type" htmlFor={ids.type}>
          {lock.locked ? (
            <p className="text-row text-ink-meta">
              <Lock aria-hidden="true" className="mr-1 inline size-3.5" />
              {ACCOUNT_TYPE_TERMS[draft.account_type].term}
              {lock.reason === "opening_balances"
                ? " — Opening Balances stays Equity."
                : lock.reason === "bank_or_card"
                  ? " — its type comes from the statements imported into it."
                  : " — it holds a bank or card, whose statements set the type."}
              {lock.reason !== "opening_balances" && (
                <>
                  {" "}
                  <Link
                    to={BANKS_SETTINGS_ROUTE}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {lock.reason === "holds_bank_or_card"
                      ? "Change them in Settings › Banks &amp; cards"
                      : "Change it in Settings › Banks &amp; cards"}
                  </Link>
                  .
                </>
              )}
            </p>
          ) : (
            <TypeCombobox
              id={ids.type}
              value={draft.account_type}
              onChange={(account_type) =>
                set(
                  withType(
                    draft,
                    account_type,
                    context.chart,
                    account?.id ?? null,
                  ),
                )
              }
              invalid={problem?.field === "account_type"}
            />
          )}
          {notice && <p className="mt-1 text-meta text-ink-meta">{notice}</p>}
        </Field>

        <Field label="Under" htmlFor={ids.parent}>
          <AccountCombobox
            id={ids.parent}
            choices={choices}
            value={draft.parent_id}
            onChange={(parent_id) => set({ parent_id })}
            placeholder="Choose an account…"
            topLevel="Top level"
            invalid={problem?.field === "parent_id"}
          />
        </Field>
      </div>

      {deleting === "blocked" && (
        <div role="alert" className="mt-4 space-y-1 text-body text-destructive">
          {blockers.map((blocker) => (
            <p key={blocker}>{blocker}</p>
          ))}
        </div>
      )}

      {deleting === "confirm" && (
        <p className="mt-4 text-body text-destructive">
          Delete {account?.name}? Its account goes from your chart; nothing
          posted on it is deleted.
        </p>
      )}

      {problem && (
        <p
          role="alert"
          className="mt-4 text-body text-destructive [overflow-wrap:anywhere]"
        >
          {problem.message}
        </p>
      )}

      <DialogFooter className="mt-6">
        {account !== null && deleting === "none" && (
          <Button
            type="button"
            variant="outline"
            className="mr-auto"
            disabled={saving || !ready}
            onClick={() =>
              setDeleting(blockers.length > 0 ? "blocked" : "confirm")
            }
          >
            Delete
          </Button>
        )}
        {deleting === "confirm" ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting("none")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={() => void remove()}
            >
              {saving ? "Deleting…" : "Delete"}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              {deleting === "blocked" ? "Close" : "Cancel"}
            </Button>
            {deleting === "none" && (
              <Button type="submit" disabled={saving || !ready}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </form>
  );
}

/** The five account types, as a static list: there is nothing to search. */
function TypeCombobox({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: LedgerAccountType;
  onChange: (account_type: LedgerAccountType) => void;
  invalid?: boolean;
}) {
  const selected = {
    type: value,
    terms: ACCOUNT_TYPE_TERMS[value],
  };
  const items = LEDGER_ACCOUNT_TYPES.map((type) => ({
    type,
    terms: ACCOUNT_TYPE_TERMS[type],
  }));
  return (
    <Combobox.Root<(typeof items)[number]>
      items={items}
      value={selected}
      onValueChange={(next) => next && onChange(next.type)}
      itemToStringLabel={(item) => item.terms.term}
      isItemEqualToValue={(a, b) => a.type === b.type}
    >
      <Combobox.InputGroup
        className={cn(comboboxClassNames.inputGroup, "bg-card")}
      >
        <Combobox.Input
          id={id}
          aria-invalid={invalid || undefined}
          className={comboboxClassNames.input}
        />
        <Combobox.Trigger
          aria-label="Show the account types"
          className={cn(comboboxClassNames.action, comboboxClassNames.trigger)}
        >
          <ChevronDown />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner
          className={cn(
            comboboxClassNames.positioner,
            "z-[calc(var(--sap-z-modal-content)+1)]",
          )}
          sideOffset={4}
        >
          <Combobox.Popup className={comboboxClassNames.popup}>
            <Combobox.List className={comboboxClassNames.list}>
              {items.map((item) => (
                <Combobox.Item
                  key={item.type}
                  value={item}
                  className={comboboxClassNames.item}
                >
                  <span className="min-w-0">
                    <span className="block">{item.terms.term}</span>
                    <span className="block text-meta text-ink-meta">
                      {item.terms.caption}
                    </span>
                  </span>
                  <Combobox.ItemIndicator
                    className={comboboxClassNames.itemIndicator}
                  >
                    <Check />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              ))}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /** The control the label names. */
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-row font-semibold text-foreground"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
