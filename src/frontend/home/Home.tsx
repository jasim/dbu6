import { Link } from "react-router-dom";
import { Menu } from "@base-ui/react/menu";
import { Plus } from "lucide-react";
import { comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import { useQuery } from "@tanstack/react-query";
import { isProblem, postingBlocks, type HomeAccount } from "../../shared/index";
import { useAuthStore } from "@sapporta/frontend/auth";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage } from "../api";
import { Button, buttonVariants } from "../components/ui/button";
import { LoadError } from "../components/load-error";
import { Screen } from "../components/screen";
import { NextStepCard } from "../components/next-step-card";
import { StatusChip, type StatusTone } from "../components/status-chip";
import { homeSummaryQuery } from "../queries";
import {
  accountLedgerHref,
  RECONCILIATION_DIFFERENCES_HREF,
} from "../reports/links";
import { reviewHref } from "../review/routes";
import { ADD_ROUTE } from "../add-account/state";
import { formatDate, plural } from "../format";
import {
  ADD_MENU,
  BANKS_SETTINGS_ROUTE,
  homeState,
  type HomeCard,
} from "./state";

/**
 * Home (PLAN.md §11 P1): where the books stand and one thing to do. One
 * request; the greeting and the card follow from the summary's state.
 */
export function Home() {
  usePageTitle("Home");
  const workspaceName = useAuthStore((s) =>
    s.session.kind === "authenticated"
      ? s.session.context.workspace.name
      : null,
  );
  const query = useQuery(homeSummaryQuery);
  const summary = query.data ?? null;
  const error = query.isError ? apiErrorMessage(query.error) : null;
  const view = summary ? homeState(summary) : null;

  return (
    <Screen
      width="wide"
      header={
        <>
          <p className="text-label uppercase text-ink-meta">{todayLabel()}</p>
          {view ? (
            view.greeting && (
              <h1 className="mt-2 text-title text-foreground sm:text-display">
                {view.greeting}
              </h1>
            )
          ) : (
            <div
              aria-hidden="true"
              className="mt-3 h-sap-ctl w-[min(420px,100%)] rounded-control bg-sap-nested"
            />
          )}
          {workspaceName && (
            <p className="mt-2 text-body text-ink-meta">{workspaceName}</p>
          )}
        </>
      }
    >
      <div className="mt-5">
        {error ? (
          <LoadError
            title="Couldn't load where your books stand"
            message={error}
            retry={() => void query.refetch()}
          />
        ) : view ? (
          <StepCard card={view.card} />
        ) : (
          <div
            aria-hidden="true"
            className="h-[132px] rounded-card border border-sap-border bg-card"
          />
        )}
      </div>

      {(view === null || view.listsAccounts) && (
        <section className="mt-4 rounded-card border border-sap-border bg-card shadow-card">
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-5">
            <h2 className="text-heading text-foreground">Your accounts</h2>
            {summary && <AddMenu />}
          </div>
          {summary ? (
            <AccountTable accounts={summary.accounts} />
          ) : error ? null : (
            <ul aria-hidden="true" className="px-4 pb-5">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="my-2 h-[52px] rounded-control bg-sap-nested"
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </Screen>
  );
}

function StepCard({ card }: { card: HomeCard }) {
  return (
    <NextStepCard
      count={card.count}
      title={card.title}
      body={card.body}
      action={
        <Button render={<Link to={card.action.to} />} nativeButton={false}>
          {card.action.label}
        </Button>
      }
    />
  );
}

/** "+ Add": a bank or card through /add, anything else through C1. */
function AddMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "data-popup-open:bg-muted",
        )}
      >
        <Plus />
        Add
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className={comboboxClassNames.positioner}
          align="end"
          sideOffset={4}
        >
          <Menu.Popup
            className={cn(comboboxClassNames.popup, "w-auto min-w-40 p-1")}
          >
            {ADD_MENU.map((item) => (
              <Menu.LinkItem
                key={item.to}
                className={cn(comboboxClassNames.item, "no-underline")}
                render={<Link to={item.to} />}
                closeOnClick
              >
                {item.label}
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function AccountTable({ accounts }: { accounts: readonly HomeAccount[] }) {
  return (
    <div className="overflow-x-auto pb-2">
      <table className="w-full text-row">
        <thead className="text-left text-meta text-ink-meta">
          <tr className="border-t border-line-inner">
            <th scope="col" className="py-2.5 pl-6 pr-3 font-medium">
              Account
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Statements imported until
            </th>
            <th scope="col" className="py-2.5 pl-3 pr-6">
              <span className="sr-only">Drafts</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <AccountRow key={account.account_id} account={account} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({ account }: { account: HomeAccount }) {
  const ledger = account.in_ledger
    ? accountLedgerHref(account.account_id)
    : null;
  const status = accountStatus(account);
  return (
    <tr className="border-t border-line-inner">
      <td className="py-2.5 pl-6 pr-3 align-top">
        {account.in_ledger && ledger ? (
          <Link
            to={ledger}
            title={account.path}
            className="font-semibold text-foreground no-underline hover:underline"
          >
            {account.name}
          </Link>
        ) : (
          <span className="font-semibold text-foreground">{account.name}</span>
        )}
        {!account.in_ledger && (
          <div className="mt-0.5 text-meta text-ink-meta">
            Deleted from your books. Remove it in{" "}
            <Link
              to={BANKS_SETTINGS_ROUTE}
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Banks &amp; cards
            </Link>
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 align-top">
        <ImportedUntil account={account} />
      </td>
      <td className="py-2.5 pl-3 pr-6 text-right align-top">
        {status &&
          (status.to ? (
            <Link
              to={status.to}
              className="-my-2 inline-flex min-h-sap-ctl items-center rounded-control no-underline outline-none hover:[&>span]:underline hover:[&>span]:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <StatusChip tone={status.tone}>{status.label}</StatusChip>
            </Link>
          ) : (
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
          ))}
      </td>
    </tr>
  );
}

/** The date of the account's last posted balance assertion. */
function ImportedUntil({ account }: { account: HomeAccount }) {
  if (!account.in_ledger) return <span className="text-ink-meta">—</span>;
  if (account.checkpoint === null) {
    return <span className="text-ink-meta">Nothing yet</span>;
  }
  return <span className="tnum">{formatDate(account.checkpoint.date)}</span>;
}

/**
 * What waits on the account, and where to see it; nothing when nothing does.
 * Problems in its drafts come first, since Review shows them; then books that
 * miss a statement balance, as an entry changed after its statement was
 * added; then drafts waiting; then an institution with no parser, whose
 * statements can't be imported until dropping them at /add teaches dbu6
 * their format.
 */
function accountStatus(account: HomeAccount): {
  tone: StatusTone;
  label: string;
  to?: string;
} | null {
  if (!account.in_ledger) {
    return { tone: "problem", label: "Account deleted" };
  }
  const review = reviewHref(account.account_id);
  if (postingBlocks(account).some(isProblem)) {
    return { tone: "problem", label: "Problems in drafts", to: review };
  }
  if (account.statement_differences > 0) {
    return {
      tone: "problem",
      label: "Doesn't match statement",
      to: RECONCILIATION_DIFFERENCES_HREF,
    };
  }
  if (account.drafts > 0) {
    return {
      tone: "attention",
      label: `${plural(account.drafts, "draft")} waiting`,
      to: review,
    };
  }
  if (!account.has_parser) {
    return {
      tone: "attention",
      label: "Needs a first statement",
      to: ADD_ROUTE,
    };
  }
  return null;
}

/** "Tuesday, 15 September 2026". */
function todayLabel(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}
