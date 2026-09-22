import {
  accountHue,
  accountLedgerHref,
  Amount,
  Button,
  categoryHueColor,
  type CategoryHueKey,
  ChevronRight,
  cn,
  Link,
  type ReactNode,
} from "../../report-kit";
import type { DateSpan, IncomeExpensesAccount } from "../../../shared/index";
import {
  amountDirection,
  formatShare,
  shareOf,
  signedAmount,
  type Section,
} from "./figures";

/*
 * Spending and Income as the account tree (PLAN.md §11 P4): the section's
 * top accounts, such as "Expenses", open on their children, and each child
 * opens one level at a time. A row's total is everything on the account and
 * below it, so it matches the account's history, which "›" opens for the
 * page's dates.
 */

const TITLES: Record<Section, string> = {
  spending: "Spending",
  income: "Income",
};

// "›" is a column at the control tier. The section's total and a parent's own
// row stop short of it by its width and the row's 12px, so amounts line up.
const CLEAR_OF_LEDGER_LINK = "pr-[calc(var(--height-sap-ctl)+12px)]";

export function AccountSection({
  section,
  total,
  accounts,
  dates,
  open,
  onOpenChange,
}: {
  section: Section;
  total: number;
  accounts: readonly IncomeExpensesAccount[];
  dates: DateSpan;
  /**
   * The accounts whose rows are open. Null until a row is opened or closed,
   * which leaves the top rows open, so one level below them shows.
   */
  open: ReadonlySet<number> | null;
  onOpenChange: (open: ReadonlySet<number>) => void;
}) {
  const shown = open ?? new Set(accounts.map((account) => account.account_id));
  const toggle = (accountId: number) => {
    const next = new Set(shown);
    if (!next.delete(accountId)) next.add(accountId);
    onOpenChange(next);
  };
  const anyOpen = someOpen(accounts, shown);
  return (
    <SectionCard
      section={section}
      total={
        <span
          className={cn(
            "tnum font-mono text-[20px] font-medium",
            amountDirection(section, total) === "in"
              ? "text-money-in"
              : "text-foreground",
          )}
        >
          {signedAmount(section, total)}
        </span>
      }
      action={
        anyOpen && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(new Set())}
          >
            Collapse all
          </Button>
        )
      }
    >
      <ul>
        {accounts.map((account) => (
          <AccountRow
            key={account.account_id}
            section={section}
            sectionTotal={total}
            account={account}
            depth={0}
            parentHue="other"
            dates={dates}
            open={shown}
            onToggle={toggle}
          />
        ))}
      </ul>
    </SectionCard>
  );
}

/** A section's card while its rows load: three row-height skeletons. */
export function AccountSectionSkeleton({ section }: { section: Section }) {
  return (
    <SectionCard section={section}>
      <ul aria-hidden="true" className="px-6 pb-4">
        {[0, 1, 2].map((i) => (
          <li key={i} className="my-2 h-[52px] rounded-control bg-sap-nested" />
        ))}
      </ul>
    </SectionCard>
  );
}

function SectionCard({
  section,
  total,
  action,
  children,
}: {
  section: Section;
  total?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 rounded-card border border-sap-border bg-card pb-2 shadow-card">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-1 py-4 pl-[22px]",
          CLEAR_OF_LEDGER_LINK,
        )}
      >
        <h2 className="text-heading text-foreground">{TITLES[section]}</h2>
        {action}
        <span className="ml-auto">{total}</span>
      </div>
      {children}
    </section>
  );
}

function AccountRow({
  section,
  sectionTotal,
  account,
  depth,
  parentHue,
  dates,
  open,
  onToggle,
}: {
  section: Section;
  sectionTotal: number;
  account: IncomeExpensesAccount;
  depth: number;
  parentHue: CategoryHueKey;
  dates: DateSpan;
  open: ReadonlySet<number>;
  onToggle: (accountId: number) => void;
}) {
  const hue = accountHue(account.name, parentHue);
  const hasChildren = account.children.length > 0;
  const isOpen = hasChildren && open.has(account.account_id);
  const body = (
    <RowBody
      section={section}
      sectionTotal={sectionTotal}
      name={account.name}
      amount={account.total}
      hue={hue}
      strong={depth === 0}
    />
  );
  const href = accountLedgerHref(account.account_id, {
    from_date: dates.first_date,
    to_date: dates.last_date,
  });

  return (
    <li>
      <div
        className={cn(
          "flex min-h-[52px] items-stretch border-t border-line-inner",
          depth > 0 && "bg-muted",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => onToggle(account.account_id)}
            className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
            style={{ paddingLeft: indent(depth) }}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-[18px] shrink-0 text-ink-meta",
                isOpen && "rotate-90",
              )}
            />
            {body}
          </button>
        ) : (
          <div
            className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-3"
            style={{ paddingLeft: indent(depth) }}
          >
            <span aria-hidden="true" className="w-[18px] shrink-0" />
            {body}
          </div>
        )}
        {href && (
          <Link
            to={href}
            aria-label={`Account ledger for ${account.name}`}
            title="Account ledger"
            className="flex w-(--height-sap-ctl) shrink-0 items-center justify-center text-[22px] text-ink-meta no-underline outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
          >
            ›
          </Link>
        )}
      </div>
      {isOpen && (
        <ul>
          {account.children.map((child) => (
            <AccountRow
              key={child.account_id}
              section={section}
              sectionTotal={sectionTotal}
              account={child}
              depth={depth + 1}
              parentHue={hue}
              dates={dates}
              open={open}
              onToggle={onToggle}
            />
          ))}
          {account.own !== 0 && (
            // The parent's own entries, so the children add up to its row.
            // No link: the parent's history includes its sub-accounts.
            <li>
              <div
                className={cn(
                  "flex min-h-[52px] items-center gap-3 border-t border-line-inner bg-muted py-3",
                  CLEAR_OF_LEDGER_LINK,
                )}
                style={{ paddingLeft: indent(depth + 1) }}
              >
                <span aria-hidden="true" className="w-[18px] shrink-0" />
                <RowBody
                  section={section}
                  sectionTotal={sectionTotal}
                  name={`${account.name}, not in a sub-account`}
                  amount={account.own}
                  hue={hue}
                  strong={false}
                />
              </div>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function RowBody({
  section,
  sectionTotal,
  name,
  amount,
  hue,
  strong,
}: {
  section: Section;
  sectionTotal: number;
  name: string;
  amount: number;
  hue: CategoryHueKey;
  strong: boolean;
}) {
  const share = shareOf(amount, sectionTotal);
  return (
    <>
      <span
        aria-hidden="true"
        className="size-[9px] shrink-0 rounded-full"
        style={{ background: categoryHueColor(hue) }}
      />
      <span className="min-w-0 flex-1">
        <span
          title={name}
          className={cn(
            "block truncate text-row text-foreground",
            strong ? "font-semibold" : "font-normal",
          )}
        >
          {name}
        </span>
        {share !== null && (
          <span
            aria-hidden="true"
            className="mt-1.5 block h-1 rounded-full"
            style={{
              width: `${Math.min(share, 1) * 100}%`,
              background:
                section === "income"
                  ? "var(--money-in)"
                  : categoryHueColor(hue),
            }}
          />
        )}
      </span>
      <span className="tnum hidden w-12 shrink-0 text-right font-mono text-meta text-ink-meta sm:block">
        {share !== null ? formatShare(share) : null}
      </span>
      <Amount
        value={amount}
        direction={amountDirection(section, amount)}
        showSymbol
        showLabel={false}
        className="shrink-0"
      />
    </>
  );
}

// Rows start where the card's header does, then step in 24px a level.
function indent(depth: number): string {
  return `${22 + 24 * depth}px`;
}

// A deeper row shows only under open rows, so a section has an open row
// showing exactly when one of its top rows is open.
function someOpen(
  accounts: readonly IncomeExpensesAccount[],
  open: ReadonlySet<number>,
): boolean {
  return accounts.some(
    (account) => account.children.length > 0 && open.has(account.account_id),
  );
}
