import { useCallback, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isBlock,
  isProblem,
  postingChecks,
  type ReviewAccountDetail,
} from "../../shared/index";
import { ApiError } from "@sapporta/shared/client";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { apiErrorMessage } from "../api";
import { EmptyState } from "../components/empty-state";
import { LoadError } from "../components/load-error";
import { Button } from "../components/ui/button";
import { formatDaySpan, formatShortDate, plural } from "../format";
import { reclassifyDraftsHref } from "../views/ReclassifyDrafts";
import {
  refreshDraftStatus,
  reviewAccountQuery,
  useRefetchOnNavigate,
} from "../queries";
import {
  checkTab,
  parseAccountId,
  REVIEW_ROUTE,
  reviewHref,
  reviewPage,
  type ReviewTab,
} from "./routes";

/** A post made from this visit's Overview, and the summary it was made from. */
export interface ReviewPosted {
  before: ReviewAccountDetail;
  draftsPosted: number;
}

export interface ReviewAccountContext {
  detail: ReviewAccountDetail;
  /** Fetch every draft count again (this summary, Home, the picker): after posting. */
  refresh: () => void;
  posted: ReviewPosted | null;
  setPosted: (posted: ReviewPosted) => void;
}

/** The account summary the frame loaded, for the tab inside it. */
export function useReviewAccount(): ReviewAccountContext {
  return useOutletContext<ReviewAccountContext>();
}

/**
 * `/review/:accountId` and its tabs (PLAN.md §11 P3): the account's name and
 * drafts, the tab bar, and the tab. The summary is fetched on entry, on every
 * tab change and after posting, so the counts follow edits made in a tab.
 */
export function ReviewAccount() {
  const accountId = parseAccountId(useParams().accountId);
  const { pathname } = useLocation();
  if (accountId === null) return <Navigate to={REVIEW_ROUTE} replace />;
  // Any path under the account that isn't a tab lands on its Overview.
  if (reviewPage(pathname, accountId) === null) {
    return <Navigate to={reviewHref(accountId)} replace />;
  }
  // A new account starts a new visit: nothing loaded, nothing posted.
  return <ReviewAccountFrame key={accountId} accountId={accountId} />;
}

function ReviewAccountFrame({ accountId }: { accountId: number }) {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const query = useQuery(reviewAccountQuery(accountId));
  useRefetchOnNavigate(query.refetch);
  const [posted, setPosted] = useState<ReviewPosted | null>(null);

  const refresh = useCallback(
    () => void refreshDraftStatus(queryClient),
    [queryClient],
  );

  const missing = query.error instanceof ApiError && query.error.status === 404;
  const detail = query.isError ? null : (query.data ?? null);
  usePageTitle(detail ? `${detail.account.name} · Review` : "Review");

  // The Drafts grid scrolls itself inside the frame; the other tabs scroll
  // with the header, like a page.
  const gridTab = reviewPage(pathname, accountId) === "drafts";

  if (missing) {
    return (
      <FramePadding>
        <h1 className="text-heading text-foreground">
          We couldn't find this account.
        </h1>
        <Button
          className="mt-3"
          render={<Link to={REVIEW_ROUTE} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
        >
          All accounts
        </Button>
      </FramePadding>
    );
  }

  if (query.isError) {
    return (
      <FramePadding>
        <LoadError
          title="Couldn't load this account's review"
          message={apiErrorMessage(query.error)}
          retry={() => void query.refetch()}
        />
      </FramePadding>
    );
  }

  if (detail === null) return <FrameSkeleton />;

  const empty = detail.account.drafts === 0 && posted === null;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-sap-surface",
        gridTab && !empty ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      {/* Two lines, so the Drafts grid keeps the height: the account and its
          drafts, then the tabs and the open tab's action. The header lines up
          with the shell's content-side sidebar toggle. */}
      <div className="shrink-0 px-5 pt-1 sm:px-8 lg:px-14">
        <FrameHeader detail={detail} />
        {!empty && (
          <Tabs
            detail={detail}
            action={
              gridTab ? (
                <RecategoriseButton accountId={detail.account.account_id} />
              ) : null
            }
          />
        )}
      </div>
      {empty ? (
        <div className="px-5 py-8 sm:px-8 lg:px-14">
          <EmptyState
            className="max-w-[760px]"
            title={`No drafts for ${detail.account.name}`}
            body="Everything imported for this account is already in your books."
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
        </div>
      ) : (
        <Outlet
          context={
            {
              detail,
              refresh,
              posted,
              setPosted,
            } satisfies ReviewAccountContext
          }
        />
      )}
    </div>
  );
}

function FramePadding({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface px-5 py-8 sm:px-8 sm:py-10 lg:px-14">
      <div className="max-w-[760px] [padding-left:var(--sap-page-header-inset,0px)]">
        {children}
      </div>
    </div>
  );
}

/**
 * One line: "‹ All accounts / Sample Savings  21 drafts · …". Where it doesn't
 * fit, the drafts line wraps under the name, and on a phone the way back
 * shrinks to its chevron.
 */
function FrameHeader({ detail }: { detail: ReviewAccountDetail }) {
  const { account } = detail;
  return (
    <header className="flex min-h-11 flex-wrap content-center items-baseline gap-x-4 [padding-left:var(--sap-page-header-inset,0px)]">
      <div className="flex min-w-0 items-baseline">
        {detail.other_accounts.length > 0 && (
          <>
            <Button
              className="-ml-2 min-w-11 px-2"
              render={<Link to={REVIEW_ROUTE} />}
              nativeButton={false}
              variant="ghost"
              size="sm"
            >
              <span aria-hidden="true">‹</span>
              <span className="max-sm:sr-only">All accounts</span>
            </Button>
            <span
              aria-hidden="true"
              className="pl-1 pr-2 text-heading font-normal text-ink-meta max-sm:hidden"
            >
              /
            </span>
          </>
        )}
        <h1
          title={account.path}
          className="truncate text-heading text-foreground"
        >
          {account.name}
        </h1>
      </div>
      <p className="text-meta text-ink-meta">{headerLine(detail)}</p>
    </header>
  );
}

/** "21 drafts · 1–13 Sep 2026 · last balance assertion 31 Aug". */
function headerLine({ account, checkpoint }: ReviewAccountDetail): string {
  const parts: string[] = [];
  if (account.drafts > 0) parts.push(plural(account.drafts, "draft"));
  if (account.draft_span) {
    parts.push(formatDaySpan(account.draft_span, { withYear: true }));
  }
  parts.push(
    checkpoint === null
      ? "no balance assertion yet"
      : `last balance assertion ${formatShortDate(checkpoint.date)}`,
  );
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const TAB_LABELS: Record<ReviewTab, string> = {
  drafts: "Drafts",
  duplicates: "Duplicates",
  "balance-checks": "Balance checks",
};

interface TabLink {
  label: string;
  to: string;
  end?: boolean;
  count?: number;
  problems?: number;
}

/**
 * The tab bar, and the open tab's action at its end. Below `lg` the tabs
 * scroll edge to edge and the action takes the line under them; from `lg` the
 * action sits on the tabs' line, and drops under them when both don't fit.
 */
function Tabs({
  detail,
  action,
}: {
  detail: ReviewAccountDetail;
  action: React.ReactNode;
}) {
  const { account } = detail;
  const tabs: TabLink[] = [
    { label: "Overview", to: reviewHref(account.account_id), end: true },
    // One tab per check, in the checks' order. Drafts counts every draft;
    // a check's own tab counts the problems it flags.
    ...postingChecks(account).map((check) => {
      const tab = checkTab(check.kind);
      return {
        label: TAB_LABELS[tab],
        to: reviewHref(account.account_id, tab),
        count: tab === "drafts" ? account.drafts : undefined,
        problems: isBlock(check) && isProblem(check) ? check.count : undefined,
      };
    }),
  ];
  return (
    <div className="mt-1.5 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3">
      <nav
        aria-label={`Review ${account.name}`}
        className="-mx-5 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:flex-1 lg:px-0"
      >
        <ul className="flex w-max gap-2.5">
          {tabs.map((tab) => (
            <li key={tab.label}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[15.5px] font-semibold no-underline outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-sap-border bg-card text-ink-soft hover:bg-muted",
                  )
                }
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="tnum font-mono text-meta font-medium">
                    {tab.count}
                  </span>
                )}
                {tab.problems !== undefined && (
                  <span className="tnum rounded-full bg-destructive px-2 py-px font-mono text-[13px] font-medium text-destructive-foreground">
                    {tab.problems}
                    <span className="sr-only"> to fix</span>
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}

/** The Drafts tab's action, on this account's drafts. */
function RecategoriseButton({ accountId }: { accountId: number }) {
  return (
    <Button
      render={<Link to={reclassifyDraftsHref(accountId)} />}
      nativeButton={false}
      variant="outline"
      size="sm"
    >
      Run the categoriser again
    </Button>
  );
}

function FrameSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex-1 overflow-hidden bg-sap-surface px-5 pt-1 sm:px-8 lg:px-14"
    >
      <div className="flex h-11 items-center [padding-left:var(--sap-page-header-inset,0px)]">
        <div className="h-7 w-[min(520px,100%)] rounded-control bg-sap-nested" />
      </div>
      <div className="mt-1.5 flex gap-2.5">
        {["w-[112px]", "w-[104px]", "w-[132px]", "w-[156px]"].map((width) => (
          <div
            key={width}
            className={cn("h-11 rounded-full bg-sap-nested", width)}
          />
        ))}
      </div>
    </div>
  );
}
