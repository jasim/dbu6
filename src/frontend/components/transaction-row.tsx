import { Checkbox } from "@sapporta/ui/checkbox";
import { cn } from "@sapporta/ui/cn";
import { Amount, type Direction } from "./amount";
import type { AccountHueKey } from "./account-hue";
import { AccountChip, NeedsAccount } from "./account-chip";

export interface Transaction {
  id: string;
  /** Already formatted for people: "13 Sep", never `2026-09-13`. */
  date: string;
  /** The row's comment, else its source narration: "UPI Sample Cafe". */
  name: string;
  /** Its source narration, the bank's own text, which rules match. */
  raw: string;
  amount: number;
  direction: Direction;
  /** The account it goes to, by name and hue, or nothing while it needs one. */
  account?: { name: string; hue: AccountHueKey };
}

/**
 * The review list's row. A fixed grid, so four hundred rows stay readable
 * and never reflow: checkbox, date, name over the raw description, account,
 * amount. Virtualise the list beyond about a hundred rows, not the row.
 */
export function TransactionRow({
  transaction,
  selected = false,
  onSelect,
  onCategorise,
}: {
  transaction: Transaction;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  onCategorise?: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[30px_96px_minmax(0,1fr)_250px_176px] items-center gap-[18px] border-t border-line-inner px-[22px] py-[13px]",
        selected && "bg-muted",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onSelect?.(checked === true)}
        aria-label={`Select ${transaction.name}`}
      />
      <span className="tnum font-mono text-[13px] text-ink-meta">
        {transaction.date}
      </span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold text-foreground">
          {transaction.name}
        </span>
        <span className="block truncate font-mono text-meta text-ink-meta">
          {transaction.raw}
        </span>
      </span>
      <span>
        {transaction.account ? (
          <AccountChip
            name={transaction.account.name}
            hue={transaction.account.hue}
          />
        ) : (
          <NeedsAccount onClick={() => onCategorise?.(transaction.id)} />
        )}
      </span>
      <Amount
        value={transaction.amount}
        direction={transaction.direction}
        className="justify-self-end"
      />
    </div>
  );
}
