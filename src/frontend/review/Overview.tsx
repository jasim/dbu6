import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@sapporta/ui/cn";
import type { ReviewAccount, ReviewAccounts } from "../../shared/index";
import { apiErrorMessage, draftTransactionsApi } from "../api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { AgentButton } from "../components/agent-prompt";
import { FactTable } from "../components/fact-table";
import type { StatusTone } from "../components/status-chip";
import { Button, waitingClassName } from "../components/ui/button";
import { joinNames } from "../format";
import { reviewAccountsQuery } from "../queries";
import { BALANCES_SETTINGS_ROUTE } from "../views/settings/routes";
import { fixAccountPrompt } from "./agentPrompts";
import {
  arrivalNotice,
  overviewView,
  postedView,
  type ArrivalNotice,
  type OverviewFact,
  type PassedRow,
  type ProblemRow,
} from "./overview-state";
import { useReviewAccount } from "./ReviewAccount";

/**
 * An account's Overview (PLAN.md §11 P3): the account, how many of its
 * transactions are in drafts, what must be fixed before they can be added,
 * each with the screen that fixes it and Fix these, which hands them all to
 * the coding agent, then the checks that passed, and the one button that
 * adds them. After an add, a notice says what it imported and what to do
 * next. A post from books that held nothing but opening balances starts the
 * first run, whose links on carry it until nothing is left to post.
 */
export function Overview() {
  const {
    detail,
    refresh,
    posted,
    setPosted,
    setup,
    imported,
    notice,
    closeNotice,
  } = useReviewAccount();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a post, the other accounts ready to add, for the way on.
  const others = useQuery({ ...reviewAccountsQuery, enabled: posted !== null });
  const name = detail.account.name;

  if (posted) {
    const view = postedView(
      posted.before,
      posted.draftsPosted,
      detail.other_accounts,
      {
        setup: setup || posted.firstPost,
        readyOthers: readyOthers(others.data, detail.account.account_id),
      },
    );
    return (
      <OverviewColumn name={name} status={view.status} facts={view.facts}>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button
            render={<Link to={view.next.to} />}
            nativeButton={false}
            size="lg"
          >
            {view.next.label}
          </Button>
          {view.also && (
            <Button
              render={<Link to={view.also.to} />}
              nativeButton={false}
              variant="outline"
              size="lg"
            >
              {view.also.label}
            </Button>
          )}
        </div>
      </OverviewColumn>
    );
  }

  const view = overviewView(detail, imported);
  const fix = (
    <AgentButton
      label="Fix these"
      prompt={fixAccountPrompt(detail.account)}
      tone={view.fix === "problems" ? "setup" : undefined}
      primary={false}
    />
  );

  async function post() {
    setPosting(true);
    setError(null);
    try {
      const result = await draftTransactionsApi.postDraftsToJournal({
        body: { base_account_id: detail.account.account_id },
      });
      setPosted({
        before: detail,
        draftsPosted: result.drafts_posted,
        firstPost: result.first_post,
      });
    } catch (e) {
      // A 422 means the drafts changed since this summary was loaded.
      setError(apiErrorMessage(e));
    } finally {
      setPosting(false);
      refresh();
    }
  }

  return (
    <OverviewColumn name={name} status={view.status} facts={view.facts}>
      {imported && (
        <ImportedNotice
          notice={arrivalNotice(detail, imported)}
          account={detail.account}
          open={notice}
          onClose={closeNotice}
        />
      )}
      {view.problems.length > 0 && (
        <div className="mt-7 w-fit max-w-full rounded-card bg-attention-bg px-5 pb-5 pt-2">
          <ul className="grid grid-cols-[auto_minmax(0,auto)_auto] items-center gap-x-4">
            {view.problems.map((row) => (
              <Problem key={row.check} row={row} />
            ))}
          </ul>
          {view.fix === "problems" && <div className="mt-4">{fix}</div>}
        </div>
      )}
      {view.passed.length > 0 && (
        <ul className="mt-5 space-y-2">
          {view.passed.map((row) => (
            <Passed key={row.check} row={row} />
          ))}
        </ul>
      )}
      {detail.no_starting_balance.length > 0 && (
        <p className="mt-5 text-body text-foreground">
          No starting balance:{" "}
          {joinNames(detail.no_starting_balance.map((one) => one.name))}.{" "}
          <Link
            to={BALANCES_SETTINGS_ROUTE}
            className="text-primary underline-offset-4 hover:underline"
          >
            Opening balances
          </Link>
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 text-body text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap items-start gap-3">
        <Button
          onClick={post}
          disabled={!view.ready || posting}
          aria-disabled={!view.ready || undefined}
          className={cn(!view.ready && waitingClassName)}
          size="lg"
        >
          {posting && <Loader2 className="animate-spin" />}
          {posting ? "Adding…" : "Add to my books"}
        </Button>
        {view.fix === "actions" && fix}
      </div>
    </OverviewColumn>
  );
}

/**
 * How many accounts but `posted` Add all would add, from Review's list as
 * last read; none before it is read.
 */
function readyOthers(
  review: ReviewAccounts | undefined,
  posted: number,
): number {
  if (review === undefined) return 0;
  return review.add_all.filter((accountId) => accountId !== posted).length;
}

/**
 * The account, its drafts in a line, and their dates and closing balance in
 * a labelled column, then what the drafts need.
 */
function OverviewColumn({
  name,
  status,
  facts,
  children,
}: {
  name: string;
  status: string;
  facts: readonly OverviewFact[];
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pb-6 pt-6 sm:px-6 lg:px-8">
      <div className="max-w-[760px]">
        <h2 className="text-title text-foreground">{name}</h2>
        <p className="mt-1 text-heading font-normal text-foreground">
          {status}
        </p>
        {facts.length > 0 && (
          <dl className="mt-4 grid w-fit grid-cols-[auto_auto] gap-x-8 gap-y-1 text-body">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-ink-meta">{fact.label}</dt>
                <dd className="tnum font-mono text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Said once, over the Overview an add lands on: what it imported, and the
 * one next step. Closing it leaves the Overview, which says the same at
 * rest.
 */
function ImportedNotice({
  notice,
  account,
  open,
  onClose,
}: {
  notice: ArrivalNotice;
  account: ReviewAccount;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span aria-hidden="true" className="text-primary">
              ✓{" "}
            </span>
            {notice.title}
          </DialogTitle>
        </DialogHeader>
        <FactTable rows={notice.facts} />
        <p className="text-body font-semibold text-foreground">{notice.next}</p>
        <DialogFooter>
          {notice.action === "fix" ? (
            <AgentButton label="Fix these" prompt={fixAccountPrompt(account)} />
          ) : notice.action ? (
            <Button
              render={<Link to={notice.action.to} />}
              nativeButton={false}
            >
              {notice.action.label}
            </Button>
          ) : (
            <Button onClick={onClose}>OK</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Something to fix, as a row of the tinted block: a mark, what is wrong in
 * a sentence, and the screen that fixes it. The block is only as wide as
 * its longest sentence, so each button sits close to its text.
 */
function Problem({ row }: { row: ProblemRow }) {
  return (
    <li className="contents">
      <Marker tone={row.tone} />
      <span className="py-3 text-subheading font-medium text-foreground">
        {row.text}
        {row.note && (
          <span className="mt-0.5 block text-meta font-normal text-ink-soft">
            {row.note}
          </span>
        )}
      </span>
      <Button
        render={<Link to={row.link.to} />}
        nativeButton={false}
        variant="attention"
        size="sm"
      >
        {row.link.label}
      </Button>
    </li>
  );
}

/** A check that passed, or had nothing to check: quiet, under the fixes. */
function Passed({ row }: { row: PassedRow }) {
  return (
    <li className="flex items-start gap-x-3.5">
      <Marker tone={row.tone} className="mt-0.5" />
      <span className="text-body text-ink-soft">
        {row.text}
        {row.note && (
          <span className="mt-0.5 block text-meta text-ink-meta">
            {row.note}
          </span>
        )}
      </span>
    </li>
  );
}

// The check's state in shape as well as colour: ✓ passes, ! needs fixing,
// a dashed ring when there is nothing to check. What needs the user is the
// only solid mark in the list; a check that passes, or has nothing to check,
// is a tint or an outline, so the eye lands on what is left to do.
const MARKER: Record<StatusTone, { glyph: string; className: string }> = {
  ok: { glyph: "✓", className: "bg-primary/10 text-primary" },
  attention: { glyph: "!", className: "bg-attention text-background" },
  problem: {
    glyph: "!",
    className: "bg-destructive text-destructive-foreground",
  },
  waiting: {
    glyph: "",
    className: "border-[1.5px] border-dashed border-waiting-marker",
  },
};

function Marker({ tone, className }: { tone: StatusTone; className?: string }) {
  const marker = MARKER[tone];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        marker.className,
        className,
      )}
    >
      {marker.glyph}
    </span>
  );
}
