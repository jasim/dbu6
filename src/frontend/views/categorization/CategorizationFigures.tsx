import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { needsCategoryHref } from "../../review/routes";
import type {
  CategorizationCounts,
  CategorizationProblem,
} from "./describeCategorization";

/*
 * What an import or a categoriser run did, as figures rather than sentences:
 * the Import statements result and Classify drafts both lay it out here.
 */

type FigureTone = "plain" | "attention" | "done";

const TONE: Record<FigureTone, string> = {
  plain: "bg-sap-nested text-foreground",
  attention: "bg-attention-bg text-attention-ink",
  done: "bg-money-in-bg text-money-in-ink",
};

const BOX = "min-w-[8.5rem] flex-1 rounded-control px-4 py-2.5";

/** A row of figures, one box each; they wrap on a narrow screen. */
export function Figures({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * One figure: its label over its number, an action beside the number, and a
 * note under it.
 */
export function Figure({
  label,
  value,
  tone = "plain",
  action,
  note,
}: {
  label: string;
  value: number;
  tone?: FigureTone;
  action?: ReactNode;
  note?: string | null;
}) {
  return (
    <div className={cn(BOX, TONE[tone])}>
      <div className={cn("text-meta", tone === "plain" && "text-ink-meta")}>
        {label}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="tnum font-mono text-subheading font-semibold">
          {value}
        </span>
        {action}
      </div>
      {note && (
        <div className={cn("text-meta", tone === "plain" && "text-ink-meta")}>
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * How many got a category and how many still need one, linked to the
 * account's drafts that do; or, when none do, one "All entries categorized"
 * box, as wide as the two it stands for.
 */
export function CategorizationFigures({
  counts,
  accountId,
}: {
  counts: CategorizationCounts;
  accountId: number;
}) {
  if (counts.remaining === 0) {
    return (
      <div
        className={cn(
          BOX,
          TONE.done,
          "flex flex-[2] items-center gap-2 text-row font-semibold",
        )}
      >
        <span aria-hidden="true">✓</span>
        All entries categorized
      </div>
    );
  }
  return (
    <>
      <Figure label="Categorized" value={counts.categorized} />
      <Figure
        label="Need a category"
        value={counts.remaining}
        tone="attention"
        action={
          <Link
            to={needsCategoryHref(accountId)}
            className="text-meta font-semibold text-attention-ink underline-offset-4 hover:underline"
          >
            Categorize
          </Link>
        }
      />
    </>
  );
}

/**
 * Why the LLM left some uncategorized, in its own words, under the figures,
 * with what to do about it.
 */
export function CategorizationNote({
  problem,
  children,
}: {
  problem: CategorizationProblem;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-0.5 rounded-control border border-attention-border bg-attention-bg px-4 py-2 text-attention-ink">
      <p className="text-row font-semibold">{problem.text}.</p>
      <p className="text-meta [overflow-wrap:anywhere]">{problem.reason}</p>
      {children && <p className="text-meta">{children}</p>}
    </div>
  );
}
