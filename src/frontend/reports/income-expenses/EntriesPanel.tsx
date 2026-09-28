import {
  accountLedgerHref,
  apiErrorMessage,
  cn,
  FRESH_QUERY,
  formatShortDate,
  journalHref,
  Link,
  plural,
  queryOptions,
  ToggleGroup,
  ToggleGroupItem,
  useQuery,
  useState,
  X,
} from "../../report-kit";
import { reportsApi } from "../client";
import type {
  DateSpan,
  IncomeExpenses,
  IncomeExpensesEntry,
} from "../../../shared/index";
import { inBar, type ChartBar } from "./chart";
import { amountDirection, signedAmount, type Section } from "./figures";
import { findAccount, subtreeIds, type Focus } from "./selection";

/*
 * The entries behind what is in focus (PLAN.md §11 P4), beside the table:
 * a section's, an account's with its sub-accounts', or a parent's own, over
 * the period or the chart's selected bar. Largest first, since the question
 * is usually "what made this so big"; or by date, as a ledger reads. Each
 * opens its journal; the account's ledger is one link away.
 */

const FIRST_ROWS = 50;

type Order = "largest" | "date";

function entriesQuery(section: Section, dates: DateSpan) {
  return queryOptions({
    queryKey: [
      "reports",
      "income-expenses",
      "entries",
      section,
      dates.first_date,
      dates.last_date,
    ],
    queryFn: () =>
      reportsApi.incomeExpensesEntries({
        query: {
          from_date: dates.first_date,
          to_date: dates.last_date,
          section,
        },
      }),
    ...FRESH_QUERY,
  });
}

export function EntriesPanel({
  report,
  dates,
  periodLabel,
  selectedBar,
  focus,
  onClose,
  className,
}: {
  report: IncomeExpenses;
  dates: DateSpan;
  periodLabel: string;
  selectedBar: ChartBar | null;
  focus: Focus;
  /** Null when there is nothing to close back to. */
  onClose: (() => void) | null;
  className?: string;
}) {
  const [order, setOrder] = useState<Order>("largest");
  const [showAll, setShowAll] = useState(false);
  const query = useQuery(entriesQuery(focus.section, dates));
  const { section } = focus;
  const account =
    focus.kind === "section"
      ? null
      : findAccount(report[section].accounts, focus.accountId);
  const accountIds =
    focus.kind === "section" || account === null
      ? null
      : focus.kind === "own"
        ? new Set([focus.accountId])
        : subtreeIds(account);
  // Name each entry's account when the panel spans more than one.
  const namesAccounts = accountIds === null || accountIds.size > 1;
  const accountNames = new Map<number, string>();
  const collect = (accounts: IncomeExpenses["income"]["accounts"]) => {
    for (const node of accounts) {
      accountNames.set(node.account_id, node.name);
      collect(node.children);
    }
  };
  collect(report[section].accounts);

  const entries = (query.data?.entries ?? []).filter(
    (entry) =>
      (accountIds === null || accountIds.has(entry.account_id)) &&
      (selectedBar === null || inBar(selectedBar, entry.date)),
  );
  const sorted =
    order === "largest"
      ? [...entries].sort((a, b) => b.amount - a.amount)
      : [...entries].reverse();
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const shown = showAll ? sorted : sorted.slice(0, FIRST_ROWS);
  const title =
    account === null
      ? section === "spending"
        ? "Spending"
        : "Income"
      : focus.kind === "own"
        ? `${account.name}, not in a sub-account`
        : account.name;
  const ledgerHref =
    account === null
      ? null
      : accountLedgerHref(account.account_id, {
          from_date: (selectedBar?.dates ?? dates).first_date,
          to_date: (selectedBar?.dates ?? dates).last_date,
        });

  return (
    <aside
      aria-label={`Entries: ${title}`}
      className={cn(
        "flex min-h-0 flex-col rounded-card border border-sap-border bg-card shadow-card",
        className,
      )}
    >
      <header className="border-b border-line-inner px-4 pt-3 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-heading text-foreground" title={title}>
              {title}
            </h2>
            <p className="mt-0.5 text-meta text-ink-meta">
              {selectedBar?.name ?? periodLabel}
              {query.data && ` · ${plural(entries.length, "entry", "entries")}`}
            </p>
          </div>
          {query.data && (
            <span
              className={cn(
                "tnum mt-0.5 font-mono text-[17px] font-semibold",
                amountDirection(section, total) === "in"
                  ? "text-money-in"
                  : "text-foreground",
              )}
            >
              {signedAmount(section, total)}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className="-mr-1 grid size-8 shrink-0 place-items-center rounded-control text-ink-meta outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <ToggleGroup<Order>
            aria-label="Order"
            value={[order]}
            onValueChange={(value) => {
              const [next] = value;
              if (next !== undefined) setOrder(next);
            }}
          >
            <ToggleGroupItem<Order> value="largest">Largest</ToggleGroupItem>
            <ToggleGroupItem<Order> value="date">Latest</ToggleGroupItem>
          </ToggleGroup>
          {ledgerHref && (
            <Link
              to={ledgerHref}
              className="text-meta font-medium text-sap-link no-underline hover:underline"
            >
              Open ledger ›
            </Link>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isError ? (
          <p className="px-4 py-3 text-meta text-ink-meta">
            Couldn't load the entries: {apiErrorMessage(query.error)}
          </p>
        ) : !query.data ? (
          <ul aria-hidden="true" className="px-4 py-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="my-2 h-9 rounded-control bg-sap-nested" />
            ))}
          </ul>
        ) : entries.length === 0 ? (
          <p className="px-4 py-3 text-meta text-ink-meta">
            No entries in {selectedBar?.name ?? "these months"}
          </p>
        ) : (
          <ul>
            {shown.map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                section={section}
                accountName={
                  namesAccounts
                    ? (accountNames.get(entry.account_id) ?? null)
                    : null
                }
              />
            ))}
            {!showAll && sorted.length > FIRST_ROWS && (
              <li className="border-t border-line-inner px-4 py-2">
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-meta font-medium text-sap-link hover:underline"
                >
                  Show all {sorted.length}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}

function EntryRow({
  entry,
  section,
  accountName,
}: {
  entry: IncomeExpensesEntry;
  section: Section;
  accountName: string | null;
}) {
  const meta = [accountName, entry.against].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        to={journalHref(entry.journal_id)}
        title="Open journal"
        className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-line-inner px-4 py-2 text-foreground no-underline outline-none first:border-t-0 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <span className="tnum font-mono text-meta text-ink-meta">
          {formatShortDate(entry.date)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px]" title={entry.narration}>
            {entry.narration || "—"}
          </span>
          {meta && (
            <span className="block truncate text-meta text-ink-meta">
              {meta}
            </span>
          )}
        </span>
        <span
          className={cn(
            "tnum font-mono text-[14px]",
            amountDirection(section, entry.amount) === "in"
              ? "text-money-in"
              : "text-foreground",
          )}
        >
          {signedAmount(section, entry.amount)}
        </span>
      </Link>
    </li>
  );
}
