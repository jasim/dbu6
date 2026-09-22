import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Input } from "@sapporta/ui";
import { FactTable } from "../../components/fact-table";
import { Button } from "../../components/ui/button";
import { formatDate, formatMoney } from "../../format";
import { readRow, type OpeningRow } from "./opening-rows";

/*
 * Adding one account's opening balance. The account is what it is: its name,
 * where it sits, and when it first has a transaction, are shown, not asked.
 * The form asks for the date, the debit or the credit, and what the balance
 * came from, which becomes the journal's description.
 */

export interface OpeningBalanceEntry {
  date: string;
  amount: number;
  description: string;
}

interface Fields {
  date: string;
  debit: string;
  credit: string;
  description: string;
}

/** The form as it opens: the account's default date and its suggestion. */
function fieldsFor(row: OpeningRow): Fields {
  const amount = (value: number | null) =>
    value === null ? "" : value.toFixed(2);
  return {
    date: row.date ?? "",
    debit: amount(row.debit),
    credit: amount(row.credit),
    description: "",
  };
}

export function OpeningBalanceDialog({
  row,
  add,
  onClose,
}: {
  /** The account being opened; null when the dialog is closed. */
  row: OpeningRow | null;
  add: (row: OpeningRow, entry: OpeningBalanceEntry) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        {row && (
          <DialogBody
            key={row.accountId}
            row={row}
            add={add}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  row,
  add,
  onClose,
}: {
  row: OpeningRow;
  add: (row: OpeningRow, entry: OpeningBalanceEntry) => Promise<unknown>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Fields>(() => fieldsFor(row));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Fields>) => setFields({ ...fields, ...patch });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reading = readRow(fields, row);
    if (!reading.ok) {
      setProblem(reading.problem);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await add(row, {
        date: reading.date,
        amount: reading.amount,
        description: fields.description.trim(),
      });
      onClose();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>Add opening balance</DialogTitle>
        <DialogDescription>
          What {row.name} held or owed the day before its first transaction. It
          is posted against Opening Balances, and every balance check on the
          account starts from it.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-1">
        <FactTable
          rows={[
            { label: "Account", value: row.path, face: "words" as const },
            {
              label: "First transaction",
              value: row.firstActivityDate
                ? formatDate(row.firstActivityDate)
                : "None yet",
            },
            ...(row.suggested === null
              ? []
              : [
                  {
                    label: "Suggested by its first balance check",
                    value: `${formatMoney(
                      (row.suggested === "debit" ? row.debit : row.credit) ?? 0,
                    )} as a ${row.suggested}`,
                    face: "words" as const,
                  },
                ]),
          ]}
        />
      </div>

      <div className="mt-5 space-y-4">
        <Field
          label="Opening date"
          hint="The day before the first transaction."
        >
          <Input
            type="date"
            value={fields.date}
            autoFocus
            onChange={(event) => set({ date: event.target.value })}
            className="tnum h-sap-ctl w-[190px] rounded-control font-mono"
          />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field label="Debit" hint="What the account holds.">
            <Input
              inputMode="decimal"
              value={fields.debit}
              placeholder="0.00"
              onChange={(event) =>
                set({ debit: event.target.value, credit: "" })
              }
              className="tnum h-sap-ctl w-[190px] rounded-control text-right font-mono"
            />
          </Field>
          <Field label="Credit" hint="What it owes: a card, a loan.">
            <Input
              inputMode="decimal"
              value={fields.credit}
              placeholder="0.00"
              onChange={(event) =>
                set({ credit: event.target.value, debit: "" })
              }
              className="tnum h-sap-ctl w-[190px] rounded-control text-right font-mono"
            />
          </Field>
        </div>
        <Field
          label="Description"
          hint="Where this balance comes from. It names the journal in your books."
        >
          <Input
            value={fields.description}
            maxLength={200}
            placeholder="Opening balance"
            onChange={(event) => set({ description: event.target.value })}
            className="h-sap-ctl w-full rounded-control"
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
          {saving ? "Adding…" : "Add opening balance"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-row font-semibold text-foreground">
        {label}
      </span>
      <span className="mt-0.5 block text-meta text-ink-meta">{hint}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { error?: unknown } }).body;
    if (body && typeof body.error === "string") return body.error;
  }
  return error instanceof Error ? error.message : String(error);
}
