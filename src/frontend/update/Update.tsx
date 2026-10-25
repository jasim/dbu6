import { Link } from "react-router-dom";
import { Menu } from "@base-ui/react/menu";
import { ChevronRight, CreditCard, Landmark, Plus } from "lucide-react";
import { comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import { useQuery } from "@tanstack/react-query";
import type { HomeAccount } from "../../shared/index";
import { useAuthStore } from "@sapporta/frontend/auth";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage } from "../api";
import { AccountParentPath } from "../components/account-name";
import { Button, buttonVariants } from "../components/ui/button";
import { LoadError } from "../components/load-error";
import { Screen } from "../components/screen";
import { NextStepCard } from "../components/next-step-card";
import { StatusChip } from "../components/status-chip";
import { homeSummaryQuery } from "../queries";
import { accountLedgerHref } from "../reports/links";
import { BANKS_SETTINGS_ROUTE } from "../views/settings/routes";
import { formatDate } from "../format";
import {
  accountStatus,
  ADD_MENU,
  statementsHref,
  updateState,
  type UpdateCard,
} from "./state";

/**
 * Update: where the books stand and one thing to do to bring them up to
 * date, once Home (PLAN.md §11 P1). One request; the greeting and the card
 * follow from the summary's state.
 */
export function Update() {
  usePageTitle("Update");
  const workspaceName = useAuthStore((s) =>
    s.session.kind === "authenticated"
      ? s.session.context.workspace.name
      : null,
  );
  const query = useQuery(homeSummaryQuery);
  const summary = query.data ?? null;
  const error = query.isError ? apiErrorMessage(query.error) : null;
  const view = summary ? updateState(summary) : null;

  return (
    <Screen
      width="narrow"
      header={
        <>
          <p className="text-label uppercase text-ink-meta">{todayLabel()}</p>
          {view ? (
            <h1 className="mt-2 text-title text-foreground sm:text-display">
              {view.greeting}
            </h1>
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
            <AccountTable
              accounts={summary.accounts}
              statementsTo={statementsHref(summary)}
            />
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

/** The one thing to do; Overview shows it too until anything is posted. */
export function StepCard({ card }: { card: UpdateCard }) {
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

function AccountTable({
  accounts,
  statementsTo,
}: {
  accounts: readonly HomeAccount[];
  /** Where an account with no statements yet gets them. */
  statementsTo: string;
}) {
  return (
    <div className="border-t border-line-inner pb-2">
      <div
        aria-hidden="true"
        className="mx-2 flex items-center gap-3 px-4 pb-1 pt-2.5 text-meta text-ink-meta"
      >
        <span className="w-9 shrink-0" />
        <span className={NAME_COLUMN}>Account</span>
        <span className={DATE_COLUMN}>Imported until</span>
        <span className="flex-1" />
        <span className="w-4 shrink-0" />
      </div>
      <ul>
        {accounts.map((account) => (
          <AccountRow
            key={account.account_id}
            account={account}
            statementsTo={statementsTo}
          />
        ))}
      </ul>
    </div>
  );
}

/*
 * The columns keep the same widths in the header and each row. The name's is
 * fixed rather than stretching, so each date sits close to its account; the
 * status takes the rest of the row.
 */
const NAME_COLUMN = "w-40 min-w-0 shrink-0 sm:w-56";
const DATE_COLUMN = "w-28 shrink-0 text-right";

/**
 * One account. The whole row opens its ledger: the name's link stretches over
 * the row, and the status link sits above it, going where the status points.
 */
function AccountRow({
  account,
  statementsTo,
}: {
  account: HomeAccount;
  statementsTo: string;
}) {
  const ledger = account.in_ledger
    ? accountLedgerHref(account.account_id)
    : null;
  const status = accountStatus(account, statementsTo);
  const Icon = account.kind === "card" ? CreditCard : Landmark;
  return (
    <li
      className={cn(
        "relative mx-2 flex items-center gap-3 rounded-control px-4 py-3",
        ledger && "hover:bg-sap-row-hover",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-tile-bg text-ink-soft"
      >
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <div className={NAME_COLUMN}>
        {account.in_ledger && ledger ? (
          <Link
            to={ledger}
            title={account.path}
            className="block truncate font-semibold text-foreground no-underline outline-none after:absolute after:inset-0 after:rounded-control after:content-[''] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40"
          >
            {account.name}
          </Link>
        ) : (
          <span className="block truncate font-semibold text-foreground">
            {account.name}
          </span>
        )}
        {account.in_ledger && account.parent_path && (
          <AccountParentPath path={account.parent_path} className="mt-0.5" />
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
      </div>
      <span className={DATE_COLUMN}>
        <ImportedUntil account={account} />
      </span>
      <div className="flex min-w-0 flex-1 justify-end">
        {status &&
          (status.to ? (
            <Link
              to={status.to}
              className="relative z-10 -my-2 inline-flex min-h-sap-ctl shrink-0 items-center rounded-control no-underline outline-none hover:[&>span]:underline hover:[&>span]:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <StatusChip tone={status.tone}>{status.label}</StatusChip>
            </Link>
          ) : (
            <StatusChip tone={status.tone} className="shrink-0">
              {status.label}
            </StatusChip>
          ))}
      </div>
      <span aria-hidden="true" className="w-4 shrink-0">
        {ledger && <ChevronRight className="size-4 text-ink-meta" />}
      </span>
    </li>
  );
}

/** The date of the account's last posted balance assertion. */
function ImportedUntil({ account }: { account: HomeAccount }) {
  if (!account.in_ledger || account.checkpoint === null) {
    return <span className="text-ink-meta">—</span>;
  }
  return <span className="tnum">{formatDate(account.checkpoint.date)}</span>;
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
