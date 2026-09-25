import { Link, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  isProblem,
  postingBlocks,
  postingCheck,
  type ReviewAccount,
} from "../../shared/index";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage } from "../api";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { Screen, ScreenTitle } from "../components/screen";
import { StatusChip, type StatusTone } from "../components/status-chip";
import { Button } from "../components/ui/button";
import { agree, formatDaySpan, plural } from "../format";
import { reviewAccountsQuery } from "../queries";
import { BooksSetUp, HandOffNote } from "./hand-off";
import { readReviewRun, reviewHref, withReviewRun } from "./routes";

/**
 * `/review` (PLAN.md §11 P3): pick the account whose drafts to check. With
 * one account holding drafts there is nothing to pick, so it goes straight
 * to that account, with what /add handed over: to its Drafts tab after an
 * import, as a later add lands. An account picked here keeps the first run
 * (`?run=setup`); the hand-off note stays here, in place of the picker's
 * own line.
 */
export function ReviewAccounts() {
  usePageTitle("Review");
  const { search } = useLocation();
  const run = readReviewRun(new URLSearchParams(search));
  const query = useQuery(reviewAccountsQuery);
  const accounts = query.data ?? null;
  const error = query.isError ? apiErrorMessage(query.error) : null;

  // The first run's end: nothing is left to pick.
  const setUp = run.setup && accounts?.length === 0;
  const handingOff = run.imported && accounts !== null && accounts.length > 0;
  const only = accounts?.length === 1 ? accounts[0] : undefined;
  if (only) {
    const to = reviewHref(only.account_id, run.imported ? "drafts" : undefined);
    return <Navigate to={`${to}${search}`} replace />;
  }

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Review">
          {!setUp && !handingOff && (
            <p>
              Pick an account to review its drafts and add them to your books.
              Each account is reviewed and added on its own.
            </p>
          )}
        </ScreenTitle>
      }
    >
      {handingOff && <HandOffNote className="mt-5" />}
      <div className="mt-5">
        {error ? (
          <LoadError
            title="Couldn't load the accounts to review"
            message={error}
            retry={() => void query.refetch()}
          />
        ) : accounts === null ? (
          <ul
            aria-hidden="true"
            className="rounded-card border border-sap-border bg-card shadow-card"
          >
            {[0, 1].map((i) => (
              <li
                key={i}
                className="border-t border-line-inner px-4 py-2.5 first:border-t-0"
              >
                <div className="h-sap-row rounded-control bg-sap-nested" />
              </li>
            ))}
          </ul>
        ) : setUp ? (
          <BooksSetUp />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            body="Drafts appear here after you import statements."
            action={
              <Button
                render={<Link to="/import" />}
                nativeButton={false}
                variant="outline"
                size="sm"
              >
                Import statements
              </Button>
            }
          />
        ) : (
          <ul className="overflow-hidden rounded-card border border-sap-border bg-card shadow-card">
            {accounts.map((account) => (
              <AccountRow
                key={account.account_id}
                account={account}
                setup={run.setup}
              />
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

function AccountRow({
  account,
  setup,
}: {
  account: ReviewAccount;
  setup: boolean;
}) {
  const status = accountStatus(account);
  return (
    <li className="border-t border-line-inner first:border-t-0">
      <Link
        to={withReviewRun(reviewHref(account.account_id), { setup })}
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 text-foreground no-underline outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <span className="min-w-0 flex-1 basis-[220px]">
          <span
            title={account.path}
            className="block text-[14.5px] font-semibold"
          >
            {account.name}
          </span>
          <span className="mt-0.5 block text-meta text-ink-meta">
            {draftsLine(account)}
          </span>
        </span>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
        <span aria-hidden="true" className="text-heading text-ink-meta">
          ›
        </span>
      </Link>
    </li>
  );
}

/** "21 drafts · 1–13 Sep". */
export function draftsLine(account: ReviewAccount): string {
  const span = account.draft_span
    ? ` · ${formatDaySpan(account.draft_span)}`
    : "";
  return `${plural(account.drafts, "draft")}${span}`;
}

function accountStatus(account: ReviewAccount): {
  tone: StatusTone;
  label: string;
} {
  if (postingBlocks(account).some(isProblem)) {
    return { tone: "problem", label: "Problems to fix" };
  }
  const categories = postingCheck(account, "categories");
  if (categories.state === "blocks") {
    return {
      tone: categories.severity,
      label: `${categories.count} ${agree(categories.count, "needs", "need")} a category`,
    };
  }
  return { tone: "ok", label: "Ready to add" };
}
