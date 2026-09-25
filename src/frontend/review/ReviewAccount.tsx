import { useCallback, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
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
import { BooksSetUp, HandOffNote } from "./hand-off";
import {
  refreshDraftStatus,
  reviewAccountQuery,
  useRefetchOnNavigate,
} from "../queries";
import {
  CATEGORIZATION_TABS,
  checkTab,
  IMPROVE_CATEGORIZATION_TAB,
  parseAccountId,
  readReviewRun,
  REVIEW_ROUTE,
  reviewHref,
  reviewPage,
  RUN_CATEGORIZER_TAB,
  withReviewRun,
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
  /** The first run (`?run=setup`), which this visit opened on. */
  setup: boolean;
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
  const { pathname, search } = useLocation();
  if (accountId === null) return <Navigate to={REVIEW_ROUTE} replace />;
  // Any path under the account that isn't a tab lands on its Overview.
  if (reviewPage(pathname, accountId) === null) {
    return <Navigate to={`${reviewHref(accountId)}${search}`} replace />;
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
  // What /add handed over, read once where the visit opened: the Drafts
  // grid rewrites its own query, and a tab change drops the note.
  const [searchParams] = useSearchParams();
  const [arrival] = useState(() => ({
    run: readReviewRun(searchParams),
    pathname,
  }));
  const { setup } = arrival.run;

  const refresh = useCallback(
    () => void refreshDraftStatus(queryClient),
    [queryClient],
  );

  const missing = query.error instanceof ApiError && query.error.status === 404;
  const detail = query.isError ? null : (query.data ?? null);
  usePageTitle(detail ? `${detail.account.name} · Review` : "Review");

  // The Drafts grids scroll themselves inside the frame; the other tabs
  // scroll with the header, like a page.
  const page = reviewPage(pathname, accountId);
  const gridTab = page === "drafts" || page === IMPROVE_CATEGORIZATION_TAB;

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
  // The note stays on the page the flow landed on, while there is
  // something to categorize and post.
  const handOff =
    arrival.run.imported && pathname === arrival.pathname && !empty && !posted;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-sap-surface",
        gridTab && !empty ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      {/* One thin bar, so the Drafts grid keeps the height: the account, then
          its tabs. It lines up with the shell's content-side sidebar toggle,
          and with the grid's toolbar below. */}
      <FrameHeader detail={detail} tabs={!empty} setup={setup} />
      {handOff && (
        <HandOffNote className="mx-4 mt-4 max-w-[760px] shrink-0 sm:mx-6 lg:mx-8" />
      )}
      {empty && setup && detail.other_accounts.length === 0 ? (
        <div className="px-4 py-5 sm:px-6 lg:px-8">
          <BooksSetUp className="max-w-[760px]" />
        </div>
      ) : empty ? (
        <div className="px-4 py-5 sm:px-6 lg:px-8">
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
              setup,
            } satisfies ReviewAccountContext
          }
        />
      )}
    </div>
  );
}

function FramePadding({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="max-w-[760px] [padding-left:var(--sap-page-header-inset,0px)]">
        {children}
      </div>
    </div>
  );
}

/**
 * One bar: the way back, the account, and its tabs, which sit on the bar's
 * rule. On a phone the way back shrinks to its chevron and the tabs scroll.
 */
function FrameHeader({
  detail,
  tabs,
  setup,
}: {
  detail: ReviewAccountDetail;
  tabs: boolean;
  setup: boolean;
}) {
  const { account } = detail;
  return (
    <header className="flex min-h-[calc(var(--height-sap-ctl)+0.5rem)] shrink-0 items-stretch gap-x-8 border-b border-sap-border pl-[calc(var(--sap-page-header-inset,0px)+0.75rem)] pr-3 sm:pl-[calc(var(--sap-page-header-inset,0px)+1.25rem)] sm:pr-5">
      <div className="flex min-w-0 shrink items-center gap-2">
        {detail.other_accounts.length > 0 && (
          <>
            <Link
              to={withReviewRun(REVIEW_ROUTE, { setup })}
              title="All accounts"
              className="shrink-0 text-meta text-ink-meta no-underline hover:text-foreground"
            >
              <span aria-hidden="true">‹</span>
              <span className="max-sm:sr-only"> All accounts</span>
            </Link>
            <span aria-hidden="true" className="text-meta text-ink-meta">
              /
            </span>
          </>
        )}
        <h1
          title={account.path}
          className="truncate text-row font-semibold text-foreground"
        >
          {account.name}
        </h1>
      </div>
      {tabs && <Tabs detail={detail} setup={setup} />}
    </header>
  );
}

const TAB_LABELS: Record<ReviewTab, string> = {
  drafts: "Drafts",
  [IMPROVE_CATEGORIZATION_TAB]: "Improve categorization",
  [RUN_CATEGORIZER_TAB]: "Run categorizer",
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
 * Text tabs on the header's rule, the open one underlined. On the first run
 * they carry it, so a reload keeps its wording.
 */
function Tabs({
  detail,
  setup,
}: {
  detail: ReviewAccountDetail;
  setup: boolean;
}) {
  const { account } = detail;
  const href = (tab?: ReviewTab) =>
    withReviewRun(reviewHref(account.account_id, tab), { setup });
  const tabs: TabLink[] = [
    { label: "Overview", to: href(), end: true },
    // One tab per check, in the checks' order, and Improve categorization
    // and Run categorizer after Drafts. Drafts counts every draft; a check's own tab counts the
    // problems it flags.
    ...postingChecks(account).flatMap((check): TabLink[] => {
      const tab = checkTab(check.kind);
      const link = {
        label: TAB_LABELS[tab],
        to: href(tab),
        count: tab === "drafts" ? account.drafts : undefined,
        problems: isBlock(check) && isProblem(check) ? check.count : undefined,
      };
      if (check.kind !== "categories") return [link];
      return [
        link,
        ...CATEGORIZATION_TABS.map((categorizationTab) => ({
          label: TAB_LABELS[categorizationTab],
          to: href(categorizationTab),
        })),
      ];
    }),
  ];
  return (
    <nav
      aria-label={`Review ${account.name}`}
      className="-mb-px flex min-w-0 overflow-x-auto overflow-y-hidden"
    >
      <ul className="flex w-max gap-6">
        {tabs.map((tab) => (
          <li key={tab.label} className="flex">
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 text-meta font-medium no-underline outline-none transition-colors duration-150 focus-visible:text-foreground focus-visible:underline",
                  isActive
                    ? "border-foreground text-foreground"
                    : "border-transparent text-ink-meta hover:text-foreground",
                )
              }
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="tnum font-mono text-label font-medium text-ink-meta">
                  {tab.count}
                </span>
              )}
              {tab.problems !== undefined && (
                <span className="tnum rounded-full bg-destructive px-1.5 font-mono text-label font-medium text-destructive-foreground">
                  {tab.problems}
                  <span className="sr-only"> to fix</span>
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function FrameSkeleton() {
  return (
    <div aria-hidden="true" className="flex-1 overflow-hidden bg-sap-surface">
      <div className="flex h-[calc(var(--height-sap-ctl)+0.5rem)] items-center gap-8 border-b border-sap-border pl-[calc(var(--sap-page-header-inset,0px)+0.75rem)] pr-3 sm:pl-[calc(var(--sap-page-header-inset,0px)+1.25rem)] sm:pr-5">
        <div className="h-4 w-[180px] rounded-control bg-sap-nested" />
        <div className="flex gap-6">
          {["w-[64px]", "w-[56px]", "w-[84px]", "w-[104px]"].map((width) => (
            <div
              key={width}
              className={cn("h-4 rounded-control bg-sap-nested", width)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
