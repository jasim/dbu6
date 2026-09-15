import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import { cn } from "@sapporta/ui/cn";
import { CopyPromptButton } from "../../components/copy-prompt-button";
import { Disclosure } from "../../components/disclosure";
import { Button } from "../../components/ui/button";
import {
  StatusChip,
  statusTextClass,
  type StatusTone,
} from "../../components/status-chip";
import { describeGroup, type Stat } from "./describeGroup";
import type { Problem, ProblemAction } from "./describeProblems";

// The glyph that says a status line's tone in shape as well as colour.
const GLYPH: Record<StatusTone, string | null> = {
  ok: "✓",
  attention: "!",
  problem: "!",
  waiting: null,
};

/**
 * A status set in words, in its tone, with the tone's glyph first. A
 * `className` colour recolours the words and leaves the glyph in its tone.
 */
export function OutcomeLine({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const glyph = GLYPH[tone];
  return (
    <p className={cn("flex gap-1.5", statusTextClass(tone), className)}>
      {glyph && (
        <span
          aria-hidden="true"
          className={cn(
            "min-w-[0.75em] shrink-0 text-center",
            statusTextClass(tone),
          )}
        >
          {glyph}
        </span>
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

// Labels on the left, values on the right. Figures are mono; words wrap.
function FactTable({ rows, heading }: { rows: Stat[]; heading?: string }) {
  if (rows.length === 0) return null;
  return (
    <div>
      {heading && (
        <div className="mb-2 text-label uppercase text-ink-meta">{heading}</div>
      )}
      <dl className="divide-y divide-line-inner rounded-control border border-sap-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 px-4 py-2.5 text-row"
          >
            <dt className="min-w-0 text-ink-soft">{row.label}</dt>
            <dd
              className={cn(
                "ml-auto min-w-0 text-right text-foreground [overflow-wrap:anywhere]",
                row.face !== "words" && "tnum font-mono font-medium",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Collapsed by default; the summary reads as a link.
// Whose statement: the title and its caption, with the status on the right.
function Subject({
  title,
  caption,
  status,
}: {
  title: string;
  caption: string | null;
  status: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-1.5">
      <div className="min-w-0 flex-1 basis-[240px]">
        <h2 className="text-[16.5px] font-semibold text-foreground [overflow-wrap:anywhere]">
          {title}
        </h2>
        {caption && (
          <p className="mt-0.5 text-meta text-ink-meta [overflow-wrap:anywhere]">
            {caption}
          </p>
        )}
      </div>
      <div className="pt-0.5">{status}</div>
    </div>
  );
}

/** One card, one row per account an import reached. */
export function ResultsCard({
  groups,
  sources,
}: {
  groups: readonly AutoImportGroupResult[];
  // The batch's file rows, for the institution and account number.
  sources: readonly AutoImportPlanFile[];
}) {
  return (
    <section className="rounded-card border border-sap-border bg-card shadow-card">
      <ul className="divide-y divide-line-inner">
        {groups.map((group) => (
          <ResultRow
            key={group.preset_name + group.base_account}
            group={group}
            sources={sources}
          />
        ))}
      </ul>
    </section>
  );
}

function ResultRow({
  group,
  sources,
}: {
  group: AutoImportGroupResult;
  sources: readonly AutoImportPlanFile[];
}) {
  const summary = describeGroup(group, sources);
  return (
    <li className="px-5 pb-3 pt-5 sm:px-6">
      <Subject
        title={summary.title}
        caption={summary.caption}
        status={
          <StatusChip tone={summary.tone === "new" ? "ok" : "waiting"}>
            {summary.chip}
          </StatusChip>
        }
      />
      <div className="mt-3 space-y-1 text-body">
        <p className="text-foreground">{summary.counts}</p>
        {summary.balances.tone === "verified" ? (
          <div className="flex flex-wrap items-baseline gap-x-3">
            <OutcomeLine tone="ok" className="text-foreground">
              {summary.balances.text}
            </OutcomeLine>
            <span className="tnum font-mono text-row text-ink-soft">
              {summary.balances.figures}
            </span>
          </div>
        ) : (
          <OutcomeLine tone="waiting">{summary.balances.text}</OutcomeLine>
        )}
        {summary.gpay && <p className="text-ink-soft">{summary.gpay}</p>}
      </div>
      <div className="mt-1">
        <Disclosure summary="Details">
          <FactTable heading="Not new because" rows={summary.breakdown} />
          <FactTable rows={summary.details} />
        </Disclosure>
      </div>
    </li>
  );
}

// One thing that stopped the import: whose statement, what went wrong, the
// numbers behind it, the likely cause, what the user can do, and the prompt
// for their coding agent.
export function ProblemCard({
  problem,
  onAction,
}: {
  problem: Problem;
  onAction: (action: ProblemAction) => void;
}) {
  return (
    <section
      className={cn(
        "rounded-card border bg-card px-5 pb-3 pt-5 shadow-card sm:px-6",
        problem.tone === "problem"
          ? "border-destructive/40"
          : "border-attention-border",
      )}
    >
      <Subject
        title={problem.subject}
        caption={problem.caption}
        status={<StatusChip tone={problem.tone}>Not imported</StatusChip>}
      />
      <p className="mt-4 text-subheading text-foreground [overflow-wrap:anywhere]">
        {problem.verdict}
      </p>
      {problem.facts.length > 0 && (
        <div className="mt-4">
          <FactTable rows={problem.facts} />
        </div>
      )}
      <div className="mt-4 space-y-2 text-body text-ink-soft [overflow-wrap:anywhere]">
        <p>{problem.why}</p>
        {problem.steps.map((step) => (
          <p key={step}>{step}</p>
        ))}
      </div>
      {problem.actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {problem.actions.map((action) =>
            action.kind === "link" ? (
              <Button
                key={action.label}
                render={<Link to={action.to} />}
                nativeButton={false}
                variant="outline"
                size="sm"
              >
                {action.label}
              </Button>
            ) : (
              <Button
                key={action.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      )}
      <div className="mt-3">
        {problem.agent && (
          <Disclosure summary="Ask your coding agent to fix this">
            <p className="text-body text-ink-soft">
              Copy this prompt into your coding agent, running in the app's
              repository. {problem.agent.afterwards}
            </p>
            <CopyPromptButton text={problem.agent.prompt} />
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-3 font-mono text-meta">
              {problem.agent.prompt}
            </pre>
          </Disclosure>
        )}
        {problem.technical && (
          <Disclosure summary="Technical details">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-control bg-muted p-3 font-mono text-meta">
              {problem.technical}
            </pre>
          </Disclosure>
        )}
      </div>
    </section>
  );
}
