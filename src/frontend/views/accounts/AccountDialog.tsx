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
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import {
  LEDGER_ACCOUNT_TYPES,
  type LedgerAccountType,
} from "../../../shared/index";
import { ACCOUNT_TYPE_TERMS } from "../../account-type-terms";
import { accountsApi, apiErrorMessage, removeAccount } from "../../api";
import { Button } from "../../components/ui/button";
import {
  accountChartQuery,
  accountHasEntriesQuery,
  importPresetsQuery,
  refreshAccounts,
} from "../../queries";
import { parseRowId } from "../../row-id";
import { BANKS_SETTINGS_ROUTE } from "../settings/routes";
import {
  NEW_ACCOUNT_DRAFT,
  accountRow,
  deleteBlockers,
  draftOf,
  moveNotice,
  nameLocked,
  readDraft,
  refusalField,
  typeLock,
  withParent,
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
  onCreated,
}: {
  /** The account being edited: "new", or the one it is. */
  editing: Editing;
  onClose: () => void;
  /** Hears a new account's id once it is saved, before the form closes. */
  onCreated?: (accountId: number) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogBody
          key={editing === "new" ? "new" : editing.id}
          account={editing === "new" ? null : editing}
          onClose={onClose}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  account,
  onClose,
  onCreated,
}: {
  account: AccountRow | null;
  onClose: () => void;
  onCreated?: (accountId: number) => void;
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
    const chart = (chartQuery.data?.rows ?? [])
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
  // A fixed type keeps the parent to accounts of that type; otherwise any
  // account will do, and the type follows the one chosen. Never the account
  // itself or one under it, which would make a loop.
  const parentLookup = useTableLookup<number>("accounts", {
    filter: lock.locked
      ? [{ column: "account_type", op: "eq", value: draft.account_type }]
      : [],
    notUnder: account?.id,
  });
  const parent =
    context.chart.find((one) => one.id === draft.parent_id) ?? null;
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
      let createdId: number | null = null;
      if (account === null) {
        const { data } = await createTableRow("accounts", body);
        const created = Array.isArray(data) ? data[0] : data;
        createdId = parseRowId(String(created?.id));
      } else {
        await accountsApi.changeAccount({ params: { id: account.id }, body });
      }
      await refreshAccounts(client);
      if (createdId !== null) onCreated?.(createdId);
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

        <Field label="Belongs under" htmlFor={ids.parent}>
          {/* Cleared, it is a top-level account. */}
          <LookupPicker
            id={ids.parent}
            lookup={parentLookup}
            value={draft.parent_id}
            onChange={(parent_id) =>
              set(withParent(draft, parent_id, context.chart))
            }
            selectedCaption="below"
            placeholder="None — this is a top-level account"
            ariaInvalid={problem?.field === "parent_id"}
            className="w-full"
          />
        </Field>

        <Field label="Category" htmlFor={ids.type}>
          {lock.locked || parent !== null ? (
            <div
              id={ids.type}
              className="flex h-sap-ctl w-full items-center justify-between rounded-md border border-input bg-muted px-3 text-sap-emph text-ink-meta"
            >
              {ACCOUNT_TYPE_TERMS[draft.account_type].term}
              {lock.locked && <Lock aria-hidden="true" className="size-3.5" />}
            </div>
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
          {lock.locked && (
            <p className="mt-1 text-meta text-ink-meta">
              {lock.reason === "opening_balances"
                ? "Fixed"
                : lock.reason === "bank_or_card"
                  ? "Set by its statements"
                  : "Set by the bank or card under it"}
              {lock.reason !== "opening_balances" && (
                <>
                  {" · "}
                  <Link
                    to={BANKS_SETTINGS_ROUTE}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Banks &amp; cards
                  </Link>
                </>
              )}
            </p>
          )}
          {notice && <p className="mt-1 text-meta text-ink-meta">{notice}</p>}
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

/** The five categories, as a static list: there is nothing to search. */
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
          aria-label="Show the categories"
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
                  <span className="min-w-0">{item.terms.term}</span>
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
