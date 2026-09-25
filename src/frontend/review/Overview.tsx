import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { apiErrorMessage, draftTransactionsApi } from "../api";
import type { StatusTone } from "../components/status-chip";
import { Button } from "../components/ui/button";
import {
  overviewView,
  postedView,
  type CheckRow,
  type Phrase,
} from "./overview-state";
import { useReviewAccount } from "./ReviewAccount";

/**
 * An account's Overview (PLAN.md §11 P3): whether its drafts can be added to
 * the books, what blocks them, and the one button that adds them.
 */
export function Overview() {
  const { detail, refresh, posted, setPosted, setup } = useReviewAccount();
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
      <OverviewColumn verdict={view.verdict}>
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

  const view = overviewView(detail);

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
    <OverviewColumn verdict={view.verdict}>
      <ul className="mt-4 overflow-hidden rounded-card border border-sap-border bg-card shadow-card">
        {view.checks.map((row) => (
          <Check key={row.check} row={row} />
        ))}
      </ul>
      {view.posting && (
        <p className="mt-4 text-body text-ink-soft">
          <PhraseText phrase={view.posting} />
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 text-body text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
      <div className="mt-4">
        <Button onClick={post} waiting={view.waiting} disabled={posting}>
          {posting && <Loader2 className="animate-spin" />}
          {posting ? "Adding…" : view.button}
        </Button>
      </div>
    </OverviewColumn>
  );
}

function OverviewColumn({
  verdict,
  children,
}: {
  verdict: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pb-6 pt-5 sm:px-6 lg:px-8">
      <section className="max-w-[760px]">
        <h2 className="text-heading text-foreground">{verdict}</h2>
        {children}
      </section>
    </div>
  );
}

function Check({ row }: { row: CheckRow }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line-inner px-4 py-2 first:border-t-0">
      <Marker tone={row.tone} />
      <span
        className={cn(
          "min-w-0 flex-1 basis-[220px] py-1.5 text-row font-semibold",
          row.tone === "waiting" ? "text-ink-meta" : "text-foreground",
        )}
      >
        {row.text}
      </span>
      {row.link && (
        <Button
          render={<Link to={row.link.to} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
        >
          {row.link.label}
        </Button>
      )}
    </li>
  );
}

// The check's state in shape as well as colour: ✓ passes, ! needs fixing,
// a dashed ring when there is nothing to check.
const MARKER: Record<StatusTone, { glyph: string; className: string }> = {
  ok: { glyph: "✓", className: "bg-primary text-primary-foreground" },
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

function Marker({ tone }: { tone: StatusTone }) {
  const marker = MARKER[tone];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[26px] shrink-0 items-center justify-center rounded-full text-[14px] font-semibold",
        marker.className,
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
