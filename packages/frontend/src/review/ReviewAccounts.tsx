import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { ReviewAccount } from "dbu6-shared";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage, reviewApi } from "../api";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { Screen, ScreenTitle } from "../components/screen";
import { StatusChip, type StatusTone } from "../components/status-chip";
import { Button } from "../components/ui/button";
import { formatDaySpan, plural } from "../views/import-statements/format";
import { reviewHref } from "./routes";

/**
 * `/review` (PLAN.md §11 P3): pick the account whose drafts to check. With
 * one account holding drafts there is nothing to pick, so it goes straight
 * to that account.
 */
export function ReviewAccounts() {
  usePageTitle("Review");
  const [accounts, setAccounts] = useState<ReviewAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    reviewApi
      .accounts({ query: {} })
      .then((body) => {
        if (live) setAccounts(body.accounts);
      })
      .catch((e: unknown) => {
        if (live) setError(apiErrorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const only = accounts?.length === 1 ? accounts[0] : undefined;
  if (only) return <Navigate to={reviewHref(only.account_id)} replace />;

  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Review">
          <p>
            Pick an account to check its drafts and add them to your books. Each
            account is checked and added on its own.
          </p>
        </ScreenTitle>
      }
    >
      <div className="mt-8">
        {error ? (
          <LoadError
            title="Couldn't load the accounts to review"
            message={error}
            retry={() => setAttempt((n) => n + 1)}
          />
        ) : accounts === null ? (
          <ul
            aria-hidden="true"
            className="rounded-card border border-sap-border bg-card shadow-card"
          >
            {[0, 1].map((i) => (
              <li
                key={i}
                className="border-t border-line-inner px-6 py-3.5 first:border-t-0"
              >
                <div className="h-[48px] rounded-control bg-sap-nested" />
              </li>
            ))}
          </ul>
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
              <AccountRow key={account.account_id} account={account} />
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

function AccountRow({ account }: { account: ReviewAccount }) {
  const status = accountStatus(account);
  return (
    <li className="border-t border-line-inner first:border-t-0">
      <Link
        to={reviewHref(account.account_id)}
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-6 py-3.5 text-foreground no-underline outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <span className="min-w-0 flex-1 basis-[220px]">
          <span
            title={account.path}
            className="block text-[16.5px] font-semibold"
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
  const span =
    account.first_date && account.last_date
      ? ` · ${formatDaySpan(account.first_date, account.last_date)}`
      : "";
  return `${plural(account.drafts, "draft")}${span}`;
}

function accountStatus(account: ReviewAccount): {
  tone: StatusTone;
  label: string;
} {
  if (account.failing_checks > 0 || account.duplicates > 0) {
    return { tone: "problem", label: "Problems to fix" };
  }
  if (account.uncategorised > 0) {
    return {
      tone: "attention",
      label: `${account.uncategorised} ${account.uncategorised === 1 ? "needs" : "need"} a category`,
    };
  }
  return { tone: "ok", label: "Ready to add" };
}
