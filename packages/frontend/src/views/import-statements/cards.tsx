import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import { cn } from "@sapporta/ui/cn";
import { AgentActions, PromptText } from "../../components/agent-prompt";
import { Disclosure } from "../../components/disclosure";
import { Button } from "../../components/ui/button";
import {
  StatusChip,
  statusTextClass,
  type StatusTone,
} from "../../components/status-chip";
import { joinNames } from "../../format";
import { describeGroup, type Stat } from "./describeGroup";
import type { Problem, ProblemAction } from "./describeProblems";

// The glyph that marks a done line in shape as well as colour. A problem
// needs no mark: its words say it, and a "!" in running text only shouts.
const GLYPH: Record<StatusTone, string | null> = {
  ok: "✓",
  attention: null,
  problem: null,
  waiting: null,
};

/**
 * A status set in words, in its tone, with the tone's glyph first when it
 * has one. A `className` colour recolours the words and leaves the glyph in
 * its tone.
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
        {summary.categorization && (
          <div>
            <OutcomeLine tone="attention">
              {summary.categorization.text}. Their new drafts are uncategorized
              in Review.
            </OutcomeLine>
            <p className="text-meta text-ink-meta [overflow-wrap:anywhere]">
              {summary.categorization.reason}
            </p>
          </div>
        )}
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

/**
 * One thing that stopped the import, under the file it concerns: what's
 * wrong, what to do, why, and the fix. The numbers behind it, the prompt
 * and the server's words fold under Details, for whoever wants them. The
 * file row above is its header, so it says nothing of the file itself.
 */
export function ProblemDetail({
  problem,
  onAction,
}: {
  problem: Problem;
  onAction: (action: ProblemAction) => void;
}) {
  // With an agent to hand the fix to, the app's own actions are the lesser
  // ways out, beside Details; without one, they are the fix.
  const { agent } = problem;
  const fixes = agent ? [] : problem.actions;
  const asides = agent ? problem.actions : [];
  const details =
    problem.facts.length > 0 || agent !== null || problem.technical !== null;
  return (
    <div>
      {problem.fileNames.length > 1 && (
        <p className="mb-1 text-meta text-ink-meta [overflow-wrap:anywhere]">
          {problem.subject} · {joinNames(problem.fileNames)}
        </p>
      )}
      <h3 className="text-subheading text-foreground [overflow-wrap:anywhere]">
        {problem.title}
      </h3>
      {problem.fix && (
        <p className="mt-3 text-body font-medium text-foreground [overflow-wrap:anywhere]">
          {problem.fix}
        </p>
      )}
      {problem.context && (
        <p
          className={cn(
            "text-body text-ink-soft [overflow-wrap:anywhere]",
            problem.fix ? "mt-1" : "mt-3",
          )}
        >
          {problem.context}
        </p>
      )}
      {agent ? (
        <div className="mt-4">
          <AgentActions
            standalone
            prompt={agent.prompt}
            afterwards={agent.afterwards}
          />
        </div>
      ) : (
        fixes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2.5">
            {fixes.map((action) => (
              <ActionButton
                key={action.label}
                action={action}
                variant="outline"
                onAction={onAction}
              />
            ))}
          </div>
        )
      )}
      {details ? (
        <div className="mt-2">
          <Disclosure
            summary="Details"
            aside={
              asides.length > 0 ? (
                <div className="flex flex-wrap gap-x-3">
                  {asides.map((action) => (
                    <ActionButton
                      key={action.label}
                      action={action}
                      variant="ghost"
                      onAction={onAction}
                    />
                  ))}
                </div>
              ) : undefined
            }
          >
            <DetailList rows={problem.facts} technical={problem.technical} />
            {agent && (
              <Disclosure tone="assist" summary="Show the prompt">
                <PromptText prompt={agent.prompt} />
              </Disclosure>
            )}
          </Disclosure>
        </div>
      ) : (
        <div className="pb-3" />
      )}
    </div>
  );
}

/**
 * A problem that concerns no file in the list, such as a lost connection:
 * the same body, under a muted header naming what it's about.
 */
export function ProblemApart({
  problem,
  onAction,
}: {
  problem: Problem;
  onAction: (action: ProblemAction) => void;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-sap-border bg-card">
      <p className="bg-tile-bg px-4 py-3 text-[16.5px] font-semibold text-foreground sm:px-5">
        {problem.subject}
      </p>
      <div className="px-4 pb-1 pt-4 sm:px-5">
        <ProblemDetail problem={problem} onAction={onAction} />
      </div>
    </section>
  );
}

function ActionButton({
  action,
  variant,
  onAction,
}: {
  action: ProblemAction;
  variant: "outline" | "ghost";
  onAction: (action: ProblemAction) => void;
}) {
  return action.kind === "link" ? (
    <Button
      render={<Link to={action.to} />}
      nativeButton={false}
      variant={variant}
      size="sm"
    >
      {action.label}
    </Button>
  ) : (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={() => onAction(action)}
    >
      {action.label}
    </Button>
  );
}

// Label and value side by side, without a box: they sit under Details, where
// the card's border is enough. The server's words come last, as it sent them.
function DetailList({
  rows,
  technical,
}: {
  rows: Stat[];
  technical: string | null;
}) {
  if (rows.length === 0 && technical === null) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-row sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-2">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className="text-ink-meta">{row.label}</dt>
          <dd
            className={cn(
              "mb-1.5 min-w-0 text-foreground [overflow-wrap:anywhere] sm:mb-0",
              row.face !== "words" && "tnum font-mono",
            )}
          >
            {row.value}
          </dd>
        </Fragment>
      ))}
      {technical !== null && (
        <>
          <dt className="text-ink-meta">Server</dt>
          <dd className="min-w-0 whitespace-pre-wrap font-mono text-meta text-ink-soft [overflow-wrap:anywhere]">
            {technical}
          </dd>
        </>
      )}
    </dl>
  );
}
