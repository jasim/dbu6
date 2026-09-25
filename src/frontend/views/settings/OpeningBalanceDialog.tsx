import { useId, useState } from "react";
import { Link } from "react-router-dom";
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
  OpeningBalanceAccount,
  OpeningSection,
} from "../../../shared/index";
import { apiErrorMessage } from "../../api";
import { Disclosure } from "../../components/disclosure";
import { Button } from "../../components/ui/button";
import { today } from "../../reports/shared";
import {
  amountHint,
  amountLabel,
  dateHint,
  fieldsFor,
  journalHref,
  lockedJournal,
  readBalance,
  signReadback,
  type BalanceFields,
} from "../../setup/opening-balances";

/*
 * Changing one account's opening balance while nothing else in the books
 * leans on it, or recording the one a link says it lacks. It asks for the
 * amount the user's way up, what it held or what they owed, and the day;
 * the note naming its journal entry waits under "More options".
 */

/** The account whose balance is open, and the table it is in. */
export interface BalanceEditing {
  account: OpeningBalanceAccount;
  section: OpeningSection;
}

/**
 * What went wrong, under the fields. A balance the server finds locked names
 * its journal entry, where the user changes it instead.
 */
export interface BalanceProblem {
  message: string;
  /** Set when the balance is locked; the dialog can then only close. */
  lockedJournal: number | null;
}

/** A failed save or removal as the dialog shows it. */
export function balanceProblem(error: unknown): BalanceProblem {
  return {
    message: apiErrorMessage(error),
    lockedJournal: lockedJournal(error),
  };
}

/** What the dialog sends: the ledger's signed amount. */
export interface BalanceEntry {
  date: string;
  amount: number;
  description?: string;
}

export function OpeningBalanceDialog({
  editing,
  save,
  onClose,
}: {
  /** Null when the dialog is closed. */
  editing: BalanceEditing | null;
  save: (
    account: OpeningBalanceAccount,
    entry: BalanceEntry,
  ) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {editing && (
          <DialogBody
            key={editing.account.account_id}
            editing={editing}
            save={save}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  editing: { account, section },
  save,
  onClose,
}: {
  editing: BalanceEditing;
  save: (
    account: OpeningBalanceAccount,
    entry: BalanceEntry,
  ) => Promise<unknown>;
  onClose: () => void;
}) {
  const ids = { amount: useId(), date: useId(), note: useId() };
  const adding = account.opening === null;
  const type = account.account_type;
  const [opened] = useState<BalanceFields>(() => fieldsFor(account, today()));
  const [fields, setFields] = useState<BalanceFields>(opened);
  const [problem, setProblem] = useState<BalanceProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<BalanceFields>) =>
    setFields({ ...fields, ...patch });

  // The suggestion is named until the user types over it.
  const fromSuggestion =
    adding &&
    account.suggested_amount !== null &&
    fields.amount === opened.amount;
  const readback = signReadback(type, fields.amount);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reading = readBalance(account, fields);
    if (!reading.ok) {
      setProblem({ message: reading.problem, lockedJournal: null });
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await save(account, {
        date: reading.date,
        amount: reading.amount,
        description: reading.description,
      });
      onClose();
    } catch (error) {
      setProblem(balanceProblem(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {adding
            ? `Add a balance for ${account.name}`
            : `Edit the balance for ${account.name}`}
        </DialogTitle>
        {!adding && section === "statement" && (
          <DialogDescription>
            Set from its first statement. Changing it moves its balance checks.
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <Field
          label={amountLabel(type)}
          hint={amountHint(type, fromSuggestion)}
          htmlFor={ids.amount}
        >
          <Input
            id={ids.amount}
            inputMode="decimal"
            autoFocus
            value={fields.amount}
            placeholder="0.00"
            onChange={(event) => set({ amount: event.target.value })}
            className="tnum h-sap-ctl w-[190px] rounded-control text-right font-mono"
          />
          {readback && (
            <span className="mt-1 block text-meta text-attention-ink">
              {readback}
            </span>
          )}
        </Field>

        <Field
          label="As of"
          hint={dateHint(account, adding)}
          htmlFor={ids.date}
        >
          <Input
            id={ids.date}
            type="date"
            value={fields.date}
            onChange={(event) => set({ date: event.target.value })}
            className="tnum h-sap-ctl w-[190px] rounded-control font-mono"
          />
        </Field>

        <Disclosure summary="More options">
          <Field
            label="Note"
            hint="Optional. Names its journal entry."
            htmlFor={ids.note}
          >
            <Input
              id={ids.note}
              value={fields.note}
              maxLength={200}
              placeholder="Opening balance"
              onChange={(event) => set({ note: event.target.value })}
              className="h-sap-ctl w-full rounded-control"
            />
          </Field>
        </Disclosure>
      </div>

      {problem && <ProblemLine problem={problem} />}

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={saving || problem?.lockedJournal != null}
        >
          {adding
            ? saving
              ? "Adding…"
              : "Add balance"
            : saving
              ? "Saving…"
              : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The problem, with a link to the journal entry of a locked balance. */
export function ProblemLine({ problem }: { problem: BalanceProblem }) {
  return (
    <p
      role="alert"
      className="mt-4 text-body text-destructive [overflow-wrap:anywhere]"
    >
      {problem.message}
      {problem.lockedJournal !== null && (
        <>
          {" "}
          <Link
            to={journalHref(problem.lockedJournal)}
            className="text-primary underline-offset-4 hover:underline"
          >
            Journal entry
          </Link>
        </>
      )}
    </p>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint: string;
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
      <span className="mt-0.5 block text-meta text-ink-meta">{hint}</span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
