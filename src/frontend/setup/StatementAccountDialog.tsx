import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Input } from "@sapporta/ui";
import type {
  AccountKind,
  StatementAccountChange,
  StatementAccountRow,
  StatementAccounts,
} from "../../shared/index";
import { apiErrorMessage } from "../api";
import { Button } from "../components/ui/button";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { AccountCombobox, InstitutionCombobox } from "./pickers";
import {
  draftOf,
  identifierHint,
  newDraft,
  otherAccountAt,
  readDraft,
  withKind,
  type StatementAccountDraft,
} from "./statement-account-form";

/*
 * Adding a bank or card, or changing one that has no transactions yet. One
 * name serves the ledger account and its statements. Where it sits in the
 * chart is picked, never guessed from a name.
 */

/** Which form is open: a new row, or a change to one. */
export type StatementAccountEditing =
  { mode: "add" } | { mode: "edit"; row: StatementAccountRow };

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
      <DialogContent className="max-w-xl">
        {editing && (
          <DialogBody
            key={editing.mode === "edit" ? editing.row.account_id : "add"}
            row={editing.mode === "edit" ? editing.row : null}
            data={data}
            save={save}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  row,
  data,
  save,
  onClose,
}: {
  row: StatementAccountRow | null;
  data: StatementAccounts;
  save: (change: StatementAccountChange) => Promise<unknown>;
  onClose: () => void;
}) {
  const ids = {
    kind: useId(),
    source: useId(),
    institution: useId(),
    name: useId(),
    existing: useId(),
    identifier: useId(),
    parent: useId(),
  };
  const [draft, setDraft] = useState<StatementAccountDraft>(() =>
    row === null ? newDraft(data) : draftOf(row),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<StatementAccountDraft>) =>
    setDraft({ ...draft, ...patch });

  const unlisted = data.unlisted.filter((one) => one.kind === draft.kind);
  const existing = row === null && draft.source === "existing";
  const other = otherAccountAt(
    data,
    draft.institution,
    row?.account_id ?? null,
  );

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

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {row === null ? "Add a bank or card" : `Change ${row.name}`}
        </DialogTitle>
        <DialogDescription>
          {row === null
            ? "An account you get statements for. dbu6 adds it to your books, under the account you pick."
            : "It has no transactions yet, so it can still change here."}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <Field label="Bank account or card" labelId={ids.kind}>
          <RadioGroup<AccountKind>
            aria-labelledby={ids.kind}
            value={draft.kind}
            onValueChange={(kind) => setDraft(withKind(draft, kind, data))}
          >
            <RadioGroupItem value="bank">Bank account</RadioGroupItem>
            <RadioGroupItem value="card">Card</RadioGroupItem>
          </RadioGroup>
        </Field>

        <Field
          label="Institution"
          hint="The bank, or the company that issues the card. Its statements are read the same way."
          htmlFor={ids.institution}
        >
          <InstitutionCombobox
            id={ids.institution}
            institutions={data.institutions.map((one) => one.name)}
            value={draft.institution}
            onChange={(institution) => set({ institution })}
          />
        </Field>

        {row === null && unlisted.length > 0 && (
          <Field label="In your books" labelId={ids.source}>
            <RadioGroup<StatementAccountDraft["source"]>
              aria-labelledby={ids.source}
              value={draft.source}
              onValueChange={(source) => set({ source })}
            >
              <RadioGroupItem value="new">Add a new account</RadioGroupItem>
              <RadioGroupItem value="existing">
                Use one already there
              </RadioGroupItem>
            </RadioGroup>
          </Field>
        )}

        {existing ? (
          <Field
            label="Account"
            hint="An account in your books no bank or card uses yet. It keeps its name and place."
            htmlFor={ids.existing}
          >
            <AccountCombobox
              id={ids.existing}
              choices={unlisted}
              value={draft.existingId}
              onChange={(existingId) => set({ existingId })}
              placeholder="Choose an account…"
            />
          </Field>
        ) : (
          <>
            <Field
              label="Name"
              hint="What your books and every screen call it, such as HDFC Savings."
              htmlFor={ids.name}
            >
              <Input
                id={ids.name}
                value={draft.name}
                maxLength={120}
                onChange={(event) => set({ name: event.target.value })}
                className="h-sap-ctl w-full rounded-control"
              />
            </Field>
            <Field
              label="Where it sits in your chart"
              hint={`Among your ${draft.kind === "card" ? "liabilities" : "assets"}, such as ${draft.kind === "card" ? "Credit Cards" : "Bank Accounts"}.`}
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
          </>
        )}

        <Field
          label={draft.kind === "card" ? "Card number" : "Account number"}
          hint={
            other
              ? `${identifierHint(draft.kind)} Needed: ${draft.institution.trim()} already has ${other.name}.`
              : `${identifierHint(draft.kind)} Optional; a sample statement in the next step can fill it.`
          }
          htmlFor={ids.identifier}
        >
          <Input
            id={ids.identifier}
            value={draft.identifier}
            maxLength={64}
            placeholder={
              draft.kind === "card" ? "050505XXXXXX0505" : "050505000012"
            }
            onChange={(event) => set({ identifier: event.target.value })}
            className="tnum h-sap-ctl w-full rounded-control font-mono"
          />
        </Field>
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
          {saving
            ? "Saving…"
            : row === null
              ? `Add ${draft.kind === "card" ? "card" : "bank account"}`
              : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  labelId,
  children,
}: {
  label: string;
  hint?: string;
  /** The control the label names, for an input. */
  htmlFor?: string;
  /** The label's own id, for a group that is labelled by it. */
  labelId?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        id={labelId}
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
