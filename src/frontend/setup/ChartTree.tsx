import { useId, useState } from "react";
import { Lock } from "lucide-react";
import { Checkbox } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@sapporta/ui/tooltip";
import type {
  ChartAccount,
  ChartRow,
  LedgerAccountType,
} from "../../shared/index";
import { chartCards, type ChartCardRow, type Ticks } from "./chart-checklist";

/** Each account type's accounting term, and what it holds in plain words. */
export const ACCOUNT_TYPE_TERMS: Record<
  LedgerAccountType,
  { term: string; caption: string }
> = {
  Asset: { term: "Assets", caption: "what you own" },
  Liability: { term: "Liabilities", caption: "what you owe" },
  Equity: { term: "Equity", caption: "where your books start" },
  Revenue: { term: "Income", caption: "money coming in" },
  Expense: { term: "Expenses", caption: "money going out" },
};

export interface ChartChecklist {
  ticks: Ticks;
  locked: Ticks;
  onToggle: (name: string) => void;
}

/**
 * A chart of accounts as one card per account type, two levels deep, with
 * deeper accounts behind "▸ {n} more" on their parent. With `checklist`,
 * each account has a box; without, it is read-only.
 */
export function ChartTree({
  accounts,
  checklist,
}: {
  accounts: readonly ChartAccount[];
  checklist?: ChartChecklist;
}) {
  // The parents whose folded accounts are on view.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (name: string) =>
    setUnfolded((was) => {
      const next = new Set(was);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <div className="gap-4 md:columns-2">
      {chartCards(accounts).map(({ type, rows }) => (
        <section
          key={type}
          className="mb-4 break-inside-avoid rounded-card border border-sap-border bg-card px-4 py-3 shadow-card"
        >
          <h3 className="text-label uppercase text-ink-meta">
            {ACCOUNT_TYPE_TERMS[type].term}
            <span className="normal-case">
              {" · "}
              {ACCOUNT_TYPE_TERMS[type].caption}
            </span>
          </h3>
          <ul className="mt-2">
            {rows.map((cardRow) => (
              <FoldedRows
                key={cardRow.row.account.name}
                cardRow={cardRow}
                open={unfolded.has(cardRow.row.account.name)}
                onFold={() => toggleFold(cardRow.row.account.name)}
                checklist={checklist}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// An account on view, its fold toggle, and, when open, what folds under it.
function FoldedRows({
  cardRow: { row, folded },
  open,
  onFold,
  checklist,
}: {
  cardRow: ChartCardRow;
  open: boolean;
  onFold: () => void;
  checklist?: ChartChecklist;
}) {
  const fold = folded.length > 0 && (
    <button
      type="button"
      aria-expanded={open}
      onClick={onFold}
      className="shrink-0 rounded-control px-1 text-meta text-ink-meta outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {open ? `▾ Hide ${folded.length}` : `▸ ${folded.length} more`}
    </button>
  );
  return (
    <>
      <ChartTreeRow row={row} checklist={checklist} fold={fold} />
      {open &&
        folded.map((below) => (
          <ChartTreeRow
            key={below.account.name}
            row={below}
            checklist={checklist}
          />
        ))}
    </>
  );
}

function ChartTreeRow({
  row,
  checklist,
  fold,
}: {
  row: ChartRow;
  checklist?: ChartChecklist;
  fold?: React.ReactNode;
}) {
  const { account, depth } = row;
  const id = useId();
  // Joined by hand: cn would drop text-row as a clash with the ink colour.
  const nameClass = [
    "text-row",
    depth === 0 ? "font-semibold" : "",
    checklist && !checklist.ticks.has(account.name)
      ? "text-ink-meta"
      : "text-foreground",
  ].join(" ");
  // A note shows on hover or focus, marked by a dotted underline.
  const name = account.note ? (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={<span tabIndex={0} />}
        className={`${nameClass} rounded-control underline decoration-ink-meta decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40`}
      >
        {account.name}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px]">
        {account.note}
      </TooltipContent>
    </Tooltip>
  ) : (
    <span className={nameClass}>{account.name}</span>
  );
  const indent = { paddingLeft: `${depth * 20}px` };

  if (!checklist) {
    return (
      <li className="flex items-baseline gap-2 py-1" style={indent}>
        {name}
        {fold}
      </li>
    );
  }
  const locked = checklist.locked.has(account.name);
  // The label sits beside the box rather than around it, so a click on the
  // box reaches it once.
  return (
    <li
      className="flex items-center gap-2 py-1"
      style={indent}
      title={locked ? "Every chart needs this account." : undefined}
    >
      <Checkbox
        id={id}
        checked={checklist.ticks.has(account.name)}
        disabled={locked}
        onCheckedChange={() => checklist.onToggle(account.name)}
      />
      <label
        htmlFor={id}
        className={cn("min-w-0", locked ? "cursor-default" : "cursor-pointer")}
      >
        {name}
        {locked && (
          <Lock
            aria-label="Always included"
            className="ml-1.5 inline size-3 text-ink-meta"
          />
        )}
      </label>
      {fold}
    </li>
  );
}
