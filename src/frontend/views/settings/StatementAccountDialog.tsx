import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Input } from "@sapporta/ui";
import type {
  StatementAccountChange,
  StatementAccountRow,
  StatementAccounts,
} from "../../../shared/index";
import { apiErrorMessage } from "../../api";
import { Disclosure } from "../../components/disclosure";
import { Button } from "../../components/ui/button";
import { AccountCombobox, InstitutionCombobox } from "../../setup/pickers";
import {
  draftOf,
  formLayout,
  numberField,
  readDraft,
  refusalField,
  underMoreOptions,
  withInstitution,
  withName,
  type FormField,
  type StatementAccountDraft,
} from "../../setup/statement-account-form";

/*
 * Editing a bank or card that has no transactions yet: its bank, name,
 * number and parent account grouping. The number is asked for in view only
 * when another account at the bank needs telling apart, and the grouping
 * waits under "More options" unless the account has none.
 */

export function StatementAccountDialog({
  row,
  data,
  save,
  onClose,
}: {
  /** The row being edited; null when the dialog is closed. */
  row: StatementAccountRow | null;
  data: StatementAccounts;
  save: (change: StatementAccountChange) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {row && (
          <DialogBody
            key={row.account_id}
            row={row}
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
  row: StatementAccountRow;
  data: StatementAccounts;
  save: (change: StatementAccountChange) => Promise<unknown>;
  onClose: () => void;
}) {
  const ids = {
    institution: useId(),
    name: useId(),
    identifier: useId(),
    parent: useId(),
  };
  const [draft, setDraft] = useState<StatementAccountDraft>(() => draftOf(row));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const set = (patch: Partial<StatementAccountDraft>) =>
    setDraft({ ...draft, ...patch });

  const layout = formLayout(draft, data, row);
  // A problem with a field under More options opens it, so the field shows.
  const showProblem = (message: string, field: FormField | null) => {
    setProblem(message);
    if (field !== null && underMoreOptions(field, layout)) setMoreOpen(true);
  };
  const card = draft.kind === "card";
  const number = numberField(draft.kind, layout, draft.institution);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reading = readDraft(draft, data, row);
    if (!reading.ok) {
      showProblem(reading.problem, reading.field);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await save(reading.change);
      onClose();
    } catch (error) {
      showProblem(apiErrorMessage(error), refusalField(error));
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
      hint="The parent account grouping it belongs to in your chart."
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
    !layout.parentInView && <div key="parent">{parentInput}</div>,
    layout.other === null && <div key="number">{numberInput}</div>,
  ].filter(Boolean);

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Edit {row.name}</DialogTitle>
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

        <Field
          label="Name"
          hint="How it appears in your books."
          htmlFor={ids.name}
        >
          <Input
            id={ids.name}
            value={draft.name}
            maxLength={120}
            onChange={(event) => setDraft(withName(draft, event.target.value))}
            className="h-sap-ctl w-full rounded-control"
          />
        </Field>

        {layout.other !== null && numberInput}
        {layout.parentInView && parentInput}

        {moreOptions.length > 0 && (
          <Disclosure
            summary="More options"
            open={moreOpen}
            onOpenChange={setMoreOpen}
          >
            {moreOptions}
          </Disclosure>
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
          {saving ? "Saving…" : "Save"}
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
