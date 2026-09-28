import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { apiErrorMessage, draftTransactionsApi } from "../api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { FactTable } from "../components/fact-table";
import { ProgressSteps, type Step } from "../components/progress-steps";
import type { StatusTone } from "../components/status-chip";
import { Button } from "../components/ui/button";
import {
  arrivalNotice,
  overviewView,
  postedView,
  type ArrivalNotice,
  type CheckRow,
  type Phrase,
} from "./overview-state";
import { useReviewAccount } from "./ReviewAccount";

/**
 * An account's Overview (PLAN.md §11 P3): where its drafts are on their way
 * into the books, whether they can be added, what blocks them, and the one
 * button that adds them. After an add, a notice says what it imported and
 * what to do next.
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

  if (posted) {
    const view = postedView(
      posted.before,
      posted.draftsPosted,
      detail.other_accounts,
      setup,
    );
    return (
      <OverviewColumn journey={view.journey} verdict={view.verdict}>
        <div className="mt-4 flex items-start gap-3.5 rounded-card border border-sap-border bg-card px-4 py-3 shadow-card">
          <Marker tone="ok" />
          <p className="text-row font-semibold text-foreground">
            <PhraseText phrase={view.outcome} />
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button render={<Link to={view.next.to} />} nativeButton={false}>
            {view.next.label}
          </Button>
          {view.also && (
            <Button
              render={<Link to={view.also.to} />}
              nativeButton={false}
              variant="ghost"
            >
              {view.also.label}
            </Button>
          )}
        </div>
      </OverviewColumn>
    );
  }

  const view = overviewView(detail, imported);

  async function post() {
    setPosting(true);
    setError(null);
    try {
      const result = await draftTransactionsApi.postDraftsToJournal({
        body: { base_account_id: detail.account.account_id },
      });
      setPosted({ before: detail, draftsPosted: result.drafts_posted });
    } catch (e) {
      // A 422 means the drafts changed since this summary was loaded.
      setError(apiErrorMessage(e));
    } finally {
      setPosting(false);
      refresh();
    }
  }

  return (
    <OverviewColumn journey={view.journey} verdict={view.verdict}>
      {imported && (
        <ImportedNotice
          notice={arrivalNotice(detail, imported)}
          open={notice}
          onClose={closeNotice}
        />
      )}
      <ul className="mt-7 space-y-4">
        {view.checks.map((row) => (
          <Check key={row.check} row={row} />
        ))}
      </ul>
      {view.posting && (
        <div className="mt-8 max-w-sm">
          <FactTable heading="Adding to your books" rows={view.posting} />
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 text-body text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
      <div className="mt-10">
        <Button
          onClick={post}
          waiting={view.waiting}
          disabled={posting}
          size="lg"
        >
          {posting && <Loader2 className="animate-spin" />}
          {posting ? "Adding…" : view.button}
        </Button>
      </div>
    </OverviewColumn>
  );
}

/**
 * The drafts' way into the books over the page, then the verdict on the
 * step they wait on, and what it holds.
 */
function OverviewColumn({
  journey,
  verdict,
  children,
}: {
  journey: readonly Step[];
  verdict: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pb-6 pt-6 sm:px-6 lg:px-8">
      <div className="max-w-[760px]">
        <ProgressSteps steps={journey} label="From statement to books" />
        <section className="mt-12">
          <h2 className="text-heading text-foreground">{verdict}</h2>
          {children}
        </section>
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
  open,
  onClose,
}: {
  notice: ArrivalNotice;
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
          {notice.action ? (
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
 * One check, as a note in the list: a small mark, the state in words, and
 * the tab that fixes it, in the same line, so the note and its way on read
 * together rather than as a row with a column of actions beside it. A check
 * the user must act on keeps the plain ink and a medium weight; one that
 * passes, or has nothing to check, steps back to the meta ink, so what is
 * left to do is what stands out.
 */
function Check({ row }: { row: CheckRow }) {
  const toFix = row.tone === "attention" || row.tone === "problem";
  return (
    <li className="flex items-start gap-x-3.5">
      <Marker tone={row.tone} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "text-body",
            toFix ? "font-medium text-foreground" : "text-ink-meta",
          )}
        >
          {row.text}
        </span>
        {row.link && (
          <Button
            className="ml-3"
            render={<Link to={row.link.to} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            {row.link.label}
          </Button>
        )}
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

/** A phrase with its figures set in mono. */
export function PhraseText({ phrase }: { phrase: Phrase }) {
  return (
    <>
      {phrase.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={index} className="tnum font-mono">
            {part.figure}
          </span>
        ),
      )}
    </>
  );
}
