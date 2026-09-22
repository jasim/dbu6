import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { Button } from "../../components/ui/button";
import { formatDate, formatMoney } from "../../format";
import type { OpeningRow } from "./opening-rows";

/*
 * The opening balances table: one account per row, listing what the books
 * hold or what the account still needs, with what to do about it on its own
 * line underneath, so the figures keep the width. Nothing is typed here — the
 * button opens the form that adds one account's opening balance — so a date
 * or amount an account has yet to record shows as the suggestion it is.
 */

const COLUMNS = 6;

export function OpeningBalancesTable({
  rows,
  onAdd,
  focusAccount,
}: {
  rows: readonly OpeningRow[];
  /** Opens the form for one account. */
  onAdd: (row: OpeningRow) => void;
  /** An account named by a link from elsewhere; its row is brought into view. */
  focusAccount?: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full text-row">
        <thead className="text-left text-meta text-ink-meta">
          <tr>
            <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">
              Account
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              First transaction
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Opening date
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Debit
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Credit
            </th>
            <th scope="col" className="py-2.5 pl-3 pr-5 font-medium">
              Description
            </th>
          </tr>
        </thead>
        {rows.map((row) => (
          <AccountRows
            key={row.accountId}
            row={row}
            onAdd={onAdd}
            focused={row.name === focusAccount}
          />
        ))}
      </table>
    </div>
  );
}

/** One account: its figures, and under them what to do about it. */
function AccountRows({
  row,
  onAdd,
  focused,
}: {
  row: OpeningRow;
  onAdd: (row: OpeningRow) => void;
  focused: boolean;
}) {
  const first = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focused) first.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const marked = focused ? "bg-attention-bg" : undefined;
  return (
    <tbody className="border-t border-line-inner">
      <tr
        ref={first}
        aria-current={focused ? "true" : undefined}
        className={marked}
      >
        <td className="pb-1 pl-5 pr-3 pt-2.5 align-top">
          <div className="font-semibold text-foreground">{row.name}</div>
          <AccountParents path={row.path} name={row.name} />
        </td>
        <td className="whitespace-nowrap px-3 pb-1 pt-2.5 align-top">
          {row.firstActivityDate ? (
            <span className="tnum">{formatDate(row.firstActivityDate)}</span>
          ) : (
            <span className="text-ink-meta">None yet</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 pb-1 pt-2.5 align-top">
          <Settled row={row}>
            {row.date && <span className="tnum">{formatDate(row.date)}</span>}
          </Settled>
        </td>
        <td className="whitespace-nowrap px-3 pb-1 pt-2.5 text-right align-top">
          <Settled row={row}>
            {row.debit !== null && (
              <span className="tnum font-mono">{formatMoney(row.debit)}</span>
            )}
          </Settled>
        </td>
        <td className="whitespace-nowrap px-3 pb-1 pt-2.5 text-right align-top">
          <Settled row={row}>
            {row.credit !== null && (
              <span className="tnum font-mono">{formatMoney(row.credit)}</span>
            )}
          </Settled>
        </td>
        <td className="pb-1 pl-3 pr-5 pt-2.5 align-top text-ink-soft">
          {row.recorded?.description}
        </td>
      </tr>
      <tr className={marked}>
        <td colSpan={COLUMNS} className="pb-3 pl-5 pr-5 pt-1">
          {row.recorded === null ? (
            <Button size="sm" variant="soft" onClick={() => onAdd(row)}>
              Add opening balance
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-meta text-ink-meta">
              <Check className="size-3.5 text-money-in" aria-hidden="true" />
              Recorded.{" "}
              <Link
                to={`/tables/journals?filter[id][eq]=${row.recorded.journalId}`}
                className="text-primary no-underline hover:text-primary-hover"
              >
                See journal entry
              </Link>
            </span>
          )}
        </td>
      </tr>
    </tbody>
  );
}

/** Where the account sits, as a quiet line under its name. */
function AccountParents({ path, name }: { path: string; name: string }) {
  const parents = path.slice(0, Math.max(0, path.length - name.length - 1));
  if (parents === "") return null;
  return (
    <div className="mt-0.5 text-meta text-ink-meta">
      {parents.split(":").join(" > ")}
    </div>
  );
}

/**
 * A figure the books hold, or, on an account without an opening balance yet,
 * the suggestion the form will open with: quieter, and it says so on hover.
 */
function Settled({
  row,
  children,
}: {
  row: OpeningRow;
  children: React.ReactNode;
}) {
  if (children === null || children === undefined || children === false) {
    return null;
  }
  if (row.recorded !== null) return <>{children}</>;
  return (
    <span
      title="A suggestion: the form opens with it, and nothing reaches your books until you add it."
      className="text-ink-meta underline decoration-dotted underline-offset-4"
    >
      {children}
    </span>
  );
}
