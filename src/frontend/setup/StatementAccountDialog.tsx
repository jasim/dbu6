import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Input } from "@sapporta/ui";
import { Switch } from "@sapporta/ui/switch";
import type {
  AccountKind,
  StatementAccountChange,
  StatementAccountRow,
  StatementAccounts,
} from "../../shared/index";
import { apiErrorMessage } from "../api";
import { Disclosure } from "../components/disclosure";
import { Button } from "../components/ui/button";
import { AccountCombobox, InstitutionCombobox } from "./pickers";
import {
  draftOf,
  formLayout,
  newDraft,
  numberField,
  readDraft,
  unlistedOf,
  withInstitution,
  withName,
  type StatementAccountDraft,
} from "./statement-account-form";

/*
 * Adding a bank account or card, or editing one that has no transactions
 * yet. It asks for the bank and nothing else it can work out: the name
 * follows the bank, the number comes from the first statement unless
 * another account at the bank needs telling apart, and where it sits in the
 * chart waits under "More options".
 */

/** Which form is open: a new bank account or card, or an edit to one. */
export type StatementAccountEditing =
  | { mode: "add"; kind: AccountKind }
  | { mode: "edit"; row: StatementAccountRow };

export function StatementAccountDialog({
  editing,
  data,
  save,
  onClose,
}: {
  /** Null when the dialog is closed. */
  editing: StatementAccountEditing | null;
  data: StatementAccounts;
  save: (change: StatementAccountChange) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {editing && (
          <DialogBody
            key={
              editing.mode === "edit"
                ? editing.row.account_id
                : `add-${editing.kind}`
            }
            editing={editing}
            data={data}
            save={save}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function title(editing: StatementAccountEditing): string {
  if (editing.mode === "edit") return `Edit ${editing.row.name}`;
  return editing.kind === "card" ? "Add a credit card" : "Add a bank account";
}

function DialogBody({
  editing,
  data,
  save,
  onClose,
}: {
  editing: StatementAccountEditing;
  data: StatementAccounts;
  save: (change: StatementAccountChange) => Promise<unknown>;
  onClose: () => void;
}) {
  const ids = {
    institution: useId(),
    name: useId(),
    existing: useId(),
    identifier: useId(),
    parent: useId(),
  };
  const row = editing.mode === "edit" ? editing.row : null;
  const [draft, setDraft] = useState<StatementAccountDraft>(() =>
    editing.mode === "edit"
      ? draftOf(editing.row)
      : newDraft(data, editing.kind),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<StatementAccountDraft>) =>
    setDraft({ ...draft, ...patch });

  const layout = formLayout(draft, data, row);
  const existing = draft.source === "existing";
  const card = draft.kind === "card";
  const number = numberField(draft.kind, layout, draft.institution);
  const parentInView = layout.parentInView && !existing;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reading = readDraft(draft, data, row);
    if (!reading.ok) {
      setProblem(reading.problem);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await save(reading.change);
      onClose();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const numberInput = (
    <Field label={number.label} hint={number.caption} htmlFor={ids.identifier}>
      <Input
        id={ids.identifier}
        value={draft.identifier}
        maxLength={64}
        placeholder={card ? "XXXX XXXX XXXX 0505" : undefined}
        onChange={(event) => set({ identifier: event.target.value })}
        className="tnum h-sap-ctl w-full rounded-control font-mono"
      />
    </Field>
  );
  const parentInput = (
    <Field
      label="Under"
      hint="Where it sits in your chart."
      htmlFor={ids.parent}
    >
      <AccountCombobox
        id={ids.parent}
        choices={data.parents[draft.kind]}
        value={draft.parentId}
        onChange={(parentId) => set({ parentId })}
        placeholder="Choose an account…"
      />
    </Field>
  );
  const moreOptions = [
    !parentInView && !existing && <div key="parent">{parentInput}</div>,
    layout.other === null && <div key="number">{numberInput}</div>,
    layout.canUseExisting && (
      <label
        key="existing"
        className="flex cursor-pointer items-center gap-2 text-row text-foreground"
      >
        <Switch
          checked={existing}
          onCheckedChange={(on) => set({ source: on ? "existing" : "new" })}
        />
        Use an account already in your books
      </label>
    ),
  ].filter(Boolean);

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{title(editing)}</DialogTitle>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <Field label={card ? "Card issuer" : "Bank"} htmlFor={ids.institution}>
          <InstitutionCombobox
            id={ids.institution}
            institutions={data.institutions.map((one) => one.name)}
            value={draft.institution}
            onChange={(institution) =>
              setDraft(withInstitution(draft, institution, data))
            }
            empty={
              card ? "Type the card issuer's name." : "Type the bank's name."
            }
          />
        </Field>

        {existing ? (
          <Field
            label="Account"
            hint="It keeps its name and place in your chart."
            htmlFor={ids.existing}
          >
            <AccountCombobox
              id={ids.existing}
              choices={unlistedOf(data, draft.kind)}
              value={draft.existingId}
              onChange={(existingId) => set({ existingId })}
              placeholder="Choose an account…"
            />
          </Field>
        ) : (
          <Field
            label="Name"
            hint="How it appears in your books."
            htmlFor={ids.name}
          >
            <Input
              id={ids.name}
              value={draft.name}
              maxLength={120}
              onChange={(event) =>
                setDraft(withName(draft, event.target.value))
              }
              className="h-sap-ctl w-full rounded-control"
            />
          </Field>
        )}

        {layout.other !== null && numberInput}
        {parentInView && parentInput}

        {moreOptions.length > 0 && (
          <Disclosure summary="More options">{moreOptions}</Disclosure>
        )}
      </div>

      {problem && (
        <p
          role="alert"
          className="mt-4 text-body text-destructive [overflow-wrap:anywhere]"
        >
          {problem}
        </p>
      )}

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : row === null ? "Add account" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
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
      {hint && (
        <span className="mt-0.5 block text-meta text-ink-meta">{hint}</span>
      )}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
