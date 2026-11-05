import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { CreditCard, Landmark } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  type HomeAccount,
  type HomeSummary,
} from "../../shared/index";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage } from "../api";
import { Button } from "../components/ui/button";
import { LoadError } from "../components/load-error";
import { Screen } from "../components/screen";
import { NextStepCard } from "../components/next-step-card";
import { StatusChip, statusTextClass } from "../components/status-chip";
import { homeSummaryQuery } from "../queries";
import {
  accountLedgerHref,
  RECONCILIATION_DIFFERENCES_HREF,
} from "../reports/links";
import { BANKS_SETTINGS_ROUTE } from "../views/settings/routes";
import { formatDate, formatMonth } from "../format";
import { DoMyBooks } from "../run/DoMyBooks";
import {
  draftsToReview,
  statementStatus,
  statementsNeededFrom,
  type DraftsToReview,
  updateState,
  type UpdateCard,
  type UpdateView,
} from "./state";

/**
 * Update: bringing the books up to date (PLAN.md §11 P1, where it is Home).
 * Everything on it helps the user find and drop the statements it needs, in
 * the order they do it: which statements to download, from which month, as
 * a compact list, then the drop and its run, which carry the page's weight.
 * One request; the greeting and the card follow from the summary's state.
 */
export function Update() {
  usePageTitle("Update");
  const query = useQuery(homeSummaryQuery);
  const summary = query.data ?? null;
  const error = query.isError ? apiErrorMessage(query.error) : null;
  const view = summary ? updateState(summary) : null;
  const drafts = summary ? draftsToReview(summary) : null;

  return (
    <Screen
      width="narrow"
      header={
<UpdateHeader greeting={view?.greeting ?? null} />
      }
    >
      {error ? (
        <div className="mt-5">
          <LoadError
            title="Couldn't load where your books stand"
            message={error}
            retry={() => void query.refetch()}
          />
        </div>
      ) : view && summary ? (
        view.firstRun ? (
          <>
            {view.listsAccounts && (
              <div className="mt-8">
                <StatementsNeeded summary={summary} />
              </div>
            )}
            {"kind" in view.card && (
              <div className="mt-6">
                <DoMyBooks
                  body={view.card.body}
                  byHand={view.card.byHand}
                  afterList={view.listsAccounts}
                  firstRun
                />
              </div>
            )}
          </>
        ) : (
          <>
            {drafts && (
              <div className="mt-8">
                <DraftsSection drafts={drafts} />
              </div>
            )}
            <div className={drafts ? "mt-12" : "mt-8"}>
              <StatementsNeeded summary={summary} />
            </div>
            <div className="mt-6">
              <DoMyBooks
                byHand={view.card.byHand}
                afterList
                choosePrimary={drafts?.review === undefined}
              />
            </div>
          </>
        )
      ) : (
        <div
          aria-hidden="true"
          className="mt-5 h-[104px] rounded-card bg-sap-nested"
        />
      )}
    </Screen>
  );
}

/**
 * Update's heading: the greeting alone, a placeholder until it loads.
 * Overview's first run shows it too, so the two first-run screens read the
 * same.
 */
export function UpdateHeader({
  greeting,
}: {
  greeting: string | null;
  /** Overview's first run still passes it; the heading is the same. */
  firstRun?: boolean;
}) {
  return greeting ? (
    <h1 className="text-title text-foreground sm:text-display">{greeting}</h1>
  ) : (
    <div
      aria-hidden="true"
      className="mt-1 h-sap-ctl w-[min(420px,100%)] rounded-control bg-sap-nested"
    />
  );
}

/**
 * The one thing to do, as Overview shows it until anything is posted: "Do my
 * books", or drafts waiting with the drop below for more statements. Update
 * puts its list of statements to download between the two. Spaced from the
 * header as Update spaces them.
 */
export function NextStep({ view }: { view: UpdateView }) {
  const { card } = view;
  if ("kind" in card) {
    return (
      <div className="mt-6">
        <DoMyBooks
          body={card.body}
          byHand={card.byHand}
          firstRun={view.firstRun}
        />
      </div>
    );
  }
  return (
    <>
      <div className="mt-5">
        <StepCard card={card} />
      </div>
      <div className="mt-10">
        <DoMyBooks byHand={card.byHand} choosePrimary={false} />
      </div>
    </>
  );
}

function StepCard({ card }: { card: UpdateCard }) {
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

/**
 * What waits on the books before more statements: each account with drafts
 * on a line of its own, with its count, and the posted statement balances
 * its books miss when any. One button reviews them all; an account's name
 * opens its own Review.
 */
function DraftsSection({ drafts }: { drafts: DraftsToReview }) {
  return (
    <section aria-label="Drafts to review">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 className="text-heading text-foreground">Drafts to review</h2>
        {drafts.review && (
          <Button
            render={<Link to={drafts.review.to} />}
            nativeButton={false}
          >
            {drafts.review.label}
          </Button>
        )}
      </div>
      {drafts.accounts.length > 0 && (
        <ul
          className={cn(
            "mt-3 grid w-fit items-baseline gap-x-10 gap-y-1.5 text-row",
            drafts.differences
              ? "grid-cols-[auto_auto_auto]"
              : "grid-cols-[auto_auto]",
          )}
        >
          {drafts.accounts.map((account) => (
            <li key={account.account_id} className="col-span-full grid grid-cols-subgrid">
              {account.drafts > 0 ? (
                <Link
                  to={account.review}
                  className="font-medium text-foreground no-underline hover:underline hover:underline-offset-4"
                >
                  {account.name}
                </Link>
              ) : (
                <span className="font-medium text-foreground">
                  {account.name}
                </span>
              )}
              <span className="tnum text-right text-foreground">
                {account.drafts > 0 && (
                  <>
                    <span className="font-semibold">{account.drafts}</span>{" "}
                    {account.drafts === 1 ? "draft" : "drafts"}
                  </>
                )}
              </span>
              {drafts.differences && (
                <span className="tnum">
                  {account.differences > 0 && (
                    <Link
                      to={RECONCILIATION_DIFFERENCES_HREF}
                      className={cn(
                        statusTextClass("problem"),
                        "no-underline hover:underline hover:underline-offset-4",
                      )}
                    >
                      <span className="font-semibold">
                        {account.differences}
                      </span>{" "}
                      {account.differences === 1
                        ? "statement difference"
                        : "statement differences"}
                    </Link>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Which statements to download: each bank and card, the month its next
 * statements start, and the last day its statements reached. A
 * compact list above the drop, read before downloading: one line per
 * account, with no rules between them, so the drop under it keeps the
 * page's weight. Its heading leads
 * into the drop's "Drop them here", which takes a new bank or card's
 * statements too, so the list has no link to adding one. The account's
 * status, when something waits on it, follows its name.
 */
function StatementsNeeded({ summary }: { summary: HomeSummary }) {
  return (
    <section aria-label="Statements to download">
      <h2 className="text-heading text-foreground">Statements to download</h2>
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-b border-line-inner text-left text-meta text-ink-meta">
            <th className="px-2 pb-1.5 font-normal">Bank or card</th>
            <th className="w-32 px-2 pb-1.5 font-normal sm:w-36">
              Download from
            </th>
            <th className="hidden w-36 px-2 pb-1.5 font-normal sm:table-cell">
              Imported until
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.accounts.map((account) => (
            <AccountRow key={account.account_id} account={account} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * One account on one line: its name, opening its ledger, and its status when
 * something waits on it; the month its statements are needed from; and the
 * day its statements reached, posted or in the drafts, from a phone's width
 * up.
 */
function AccountRow({ account }: { account: HomeAccount }) {
  const status = statementStatus(account);
  const ledger = account.in_ledger
    ? accountLedgerHref(account.account_id)
    : null;
  const Icon = account.kind === "card" ? CreditCard : Landmark;
  return (
    <tr className="align-baseline">
      <td className="px-2 py-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="min-w-0 break-words text-row font-medium">
            <Icon
              aria-hidden="true"
              className="mr-2 inline size-4 align-[-2px] text-ink-meta"
              strokeWidth={1.75}
            />
            {account.in_ledger && ledger ? (
              <Link
                to={ledger}
                title={account.path}
                className="text-foreground no-underline hover:underline hover:underline-offset-4"
              >
                {account.name}
              </Link>
            ) : (
              <span className="text-foreground">{account.name}</span>
            )}
          </span>
          {account.in_ledger && status && (
            <span className="self-center">
              {status.to ? (
                <Link
                  to={status.to}
                  className="inline-flex rounded-control no-underline outline-none hover:[&>span]:underline hover:[&>span]:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <StatusChip tone={status.tone}>{status.label}</StatusChip>
                </Link>
              ) : (
                <StatusChip tone={status.tone}>{status.label}</StatusChip>
              )}
            </span>
          )}
        </div>
        {!account.in_ledger && (
          <p className="mt-0.5 text-meta text-ink-meta">
            Deleted from your books. Remove it in{" "}
            <Link
              to={BANKS_SETTINGS_ROUTE}
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Banks &amp; cards
            </Link>
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-row font-semibold">
        <NeededFrom account={account} />
      </td>
      <td className="hidden whitespace-nowrap px-2 py-1.5 text-row text-ink-meta sm:table-cell">
        <ImportedUntil account={account} />
      </td>
    </tr>
  );
}

/**
 * The last day its statements cover, posted or waiting in the drafts: the
 * day "Download from" follows.
 */
function ImportedUntil({ account }: { account: HomeAccount }) {
  if (!account.in_ledger || account.statements_until === null) {
    return <span className="text-ink-meta">—</span>;
  }
  return <span className="tnum">{formatDate(account.statements_until)}</span>;
}

/**
 * "Oct 2026": the month the account's next statements start; every statement
 * it has before its first.
 */
function NeededFrom({ account }: { account: HomeAccount }) {
  if (!account.in_ledger) return <span className="text-ink-meta">—</span>;
  const month = statementsNeededFrom(account);
  if (month === null)
    return <span className="text-ink-meta">All you have</span>;
  return <span className="tnum text-foreground">{formatMonth(month)}</span>;
}
