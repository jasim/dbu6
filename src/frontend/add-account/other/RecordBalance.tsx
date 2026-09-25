import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Input } from "@sapporta/ui";
import type { OpeningBalanceAccount } from "../../../shared/index";
import { apiErrorMessage, openingBalancesApi } from "../../api";
import { Button } from "../../components/ui/button";
import { today } from "../../reports/shared";
import { AccountCombobox } from "../../setup/pickers";
// Step 8 moves these with the Other balances step, if its file goes.
import {
  amountLabel,
  dateHint,
  fieldsFor,
  readBalance,
  signReadback,
  type BalanceFields,
} from "../../setup/other-balances";
import { FocusCard, type FocusFrame } from "../FocusCard";
import { recordTitle } from "./state";

/**
 * C1: which account in the chart, what it held (or what the user owed on
 * it), and on what day. The amount is typed positive; `readBalance` gives
 * it the ledger's sign. The day starts at the account's default: the day
 * before its first activity, else the day the books start, else today.
 */
export function RecordBalance({
  frame,
  choices,
  back,
  onRecorded,
  onRefused,
}: {
  frame: FocusFrame;
  /** The chart's accounts with no opening yet, own then owe (`unrecorded`). */
  choices: readonly OpeningBalanceAccount[];
  /** Card 6 on the first run; null later, where Leave is the way out. */
  back: string | null;
  onRecorded: (accountId: number) => void;
  /** The server refused: its list may be out of date. */
  onRefused: () => void;
}) {
  const ids = { account: useId(), amount: useId(), date: useId() };
  const [accountId, setAccountId] = useState<number | null>(() =>
    choices.length === 1 ? choices[0].account_id : null,
  );
  const account = choices.find((one) => one.account_id === accountId) ?? null;
  const [fields, setFields] = useState<BalanceFields>(() =>
    account === null
      ? { amount: "", date: "", note: "" }
      : fieldsFor(account, today()),
  );
  // The first thing wrong with the fields, or the server's refusal.
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(id: number | null) {
    const next = choices.find((one) => one.account_id === id) ?? null;
    setAccountId(id);
    // The day is the account's; the amount typed stays.
    if (next !== null) {
      setFields({ ...fields, date: fieldsFor(next, today()).date });
    }
    setProblem(null);
  }

  async function record() {
    if (account === null) return;
    const reading = readBalance(account, fields);
    if (!reading.ok) {
      setProblem(reading.problem);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await openingBalancesApi.record({
        body: {
          account_id: account.account_id,
          date: reading.date,
          amount: reading.amount,
        },
      });
    } catch (error) {
      setProblem(apiErrorMessage(error));
      setBusy(false);
      onRefused();
      return;
    }
    onRecorded(account.account_id);
  }

  const type = account?.account_type ?? "Asset";
  const readback = signReadback(type, fields.amount);

  return (
    <FocusCard
      {...frame}
      title={recordTitle(account)}
      actions={
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-2">
            {back !== null && (
              <Button
                variant="outline"
                render={<Link to={back} />}
                nativeButton={false}
              >
                Back
              </Button>
            )}
            <Button
              disabled={account === null || busy}
              onClick={() => void record()}
            >
              {busy ? "Recording…" : "Record balance"}
            </Button>
          </div>
          {problem && !busy && (
            <p
              role="alert"
              className="max-w-[440px] text-right text-meta text-destructive [overflow-wrap:anywhere]"
            >
              {problem}
            </p>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <Field id={ids.account} label="Account">
          <AccountCombobox
            id={ids.account}
            choices={choices.map((one) => ({
              id: one.account_id,
              name: one.name,
              path: one.path,
            }))}
            value={accountId}
            onChange={pick}
            placeholder="Pick an account"
          />
          <p className="text-meta text-ink-meta">
            Not in your chart? Add it on the{" "}
            <Link
              to="/accounts"
              className="text-primary underline-offset-4 hover:underline"
            >
              Accounts page
            </Link>
            .
          </p>
        </Field>
        {account !== null && (
          <>
            <Field id={ids.amount} label={amountLabel(type)}>
              <Input
                id={ids.amount}
                inputMode="decimal"
                autoFocus
                value={fields.amount}
                placeholder="0.00"
                onChange={(event) =>
                  setFields({ ...fields, amount: event.target.value })
                }
                className="tnum h-sap-ctl w-[200px] rounded-control text-right font-mono"
              />
              {readback && (
                <p className="text-meta text-attention-ink">{readback}</p>
              )}
            </Field>
            <Field id={ids.date} label="As of" hint={dateHint(account, true)}>
              <Input
                id={ids.date}
                type="date"
                value={fields.date}
                onChange={(event) =>
                  setFields({ ...fields, date: event.target.value })
                }
                className="tnum h-sap-ctl w-[200px] rounded-control font-mono"
              />
            </Field>
          </>
        )}
      </div>
    </FocusCard>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-row font-semibold text-foreground"
      >
        {label}
      </label>
      {hint && <p className="text-meta text-ink-meta">{hint}</p>}
      {children}
    </div>
  );
}
