import { Lock } from "lucide-react";
import { Checkbox } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import {
  chartInTreeOrder,
  LEDGER_ACCOUNT_TYPES,
  type ChartAccount,
  type ChartRow,
  type LedgerAccountType,
} from "../../shared/index";
import type { Ticks } from "./chart-checklist";

// What each type of account holds, in plain words.
const TYPE_HEADINGS: Record<LedgerAccountType, string> = {
  Asset: "What you own",
  Liability: "What you owe",
  Equity: "Where your books start",
  Revenue: "Money coming in",
  Expense: "Money going out",
};

export interface ChartChecklist {
  ticks: Ticks;
  locked: Ticks;
  onToggle: (name: string) => void;
}

/**
 * A chart of accounts as an indented tree, one section per account type.
 * With `checklist`, each account has a box; without, it is read-only.
 */
export function ChartTree({
  accounts,
  checklist,
}: {
  accounts: readonly ChartAccount[];
  checklist?: ChartChecklist;
}) {
  const rows = chartInTreeOrder(accounts);
  return (
    <div className="gap-4 md:columns-2">
      {LEDGER_ACCOUNT_TYPES.map((type) => {
        const ofType = rows.filter((row) => row.account.account_type === type);
        if (ofType.length === 0) return null;
        return (
          <section
            key={type}
            className="mb-4 break-inside-avoid rounded-card border border-sap-border bg-card px-4 py-3 shadow-card"
          >
            <h3 className="text-label uppercase text-ink-meta">
              {TYPE_HEADINGS[type]}
            </h3>
            <ul className="mt-2">
              {ofType.map((row) => (
                <ChartTreeRow
                  key={row.account.name}
                  row={row}
                  checklist={checklist}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ChartTreeRow({
  row,
  checklist,
}: {
  row: ChartRow;
  checklist?: ChartChecklist;
}) {
  const { account, depth } = row;
  const name = (
    <span
      className={cn(
        "text-row text-foreground",
        depth === 0 && "font-semibold",
        checklist && !checklist.ticks.has(account.name) && "text-ink-meta",
      )}
    >
      {account.name}
    </span>
  );
  const note = account.note && (
    <span className="block text-meta text-ink-meta">{account.note}</span>
  );
  const indent = { paddingLeft: `${depth * 20}px` };

  if (!checklist) {
    return (
      <li className="py-1" style={indent}>
        {name}
        {note}
      </li>
    );
  }
  const locked = checklist.locked.has(account.name);
  return (
    <li style={indent}>
      <label
        className={cn(
          "flex items-start gap-2 py-1",
          locked ? "cursor-default" : "cursor-pointer",
        )}
        title={locked ? "Every chart needs this account." : undefined}
      >
        <Checkbox
          className="mt-0.5"
          checked={checklist.ticks.has(account.name)}
          disabled={locked}
          onCheckedChange={() => checklist.onToggle(account.name)}
        />
        <span className="min-w-0">
          {name}
          {locked && (
            <Lock
              aria-label="Always included"
              className="ml-1.5 inline size-3 text-ink-meta"
            />
          )}
          {note}
        </span>
      </label>
    </li>
  );
}
