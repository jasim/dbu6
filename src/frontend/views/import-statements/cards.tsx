import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CreditCard, Landmark } from "lucide-react";
import type {
  AutoImportGroupResult,
  AutoImportPlanFile,
} from "../../../shared/index";
import { cn } from "@sapporta/ui/cn";
import { AgentActions, PromptText } from "../../components/agent-prompt";
import { Disclosure } from "../../components/disclosure";
import { Button } from "../../components/ui/button";
import { statusTextClass, type StatusTone } from "../../components/status-chip";
import { joinNames } from "../../format";
import { FactTable } from "../../components/fact-table";
import {
  CategorizationFigures,
  CategorizationNote,
  Figure,
  Figures,
} from "../categorization/CategorizationFigures";
import { reviewHref, RUN_CATEGORIZER_TAB } from "../../review/routes";
import { describeGroup, type ClosingBalance, type Stat } from "./describeGroup";
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

/** One card per account an import reached, apart, so each reads alone. */
export function ResultsCard({
  groups,
  sources,
}: {
  groups: readonly AutoImportGroupResult[];
  // The batch's file rows, for the account number.
  sources: readonly AutoImportPlanFile[];
}) {
  return (
    <ul className="space-y-4">
      {groups.map((group) => (
        <AccountResult key={group.account_id} group={group} sources={sources} />
      ))}
    </ul>
  );
}

// One account's card, top to bottom: a header band naming the account, then
// what came in and whether it still needs a category, the closing balance,
// and the categories and the facts behind the import folded away.
function AccountResult({
  group,
  sources,
}: {
  group: AutoImportGroupResult;
  sources: readonly AutoImportPlanFile[];
}) {
  const summary = describeGroup(group, sources);
  const accountId = group.result.base_account_id;
  const Icon = summary.accountKind === "card" ? CreditCard : Landmark;
  return (
    <li className="overflow-hidden rounded-card border border-sap-border bg-card shadow-card">
      <div className="flex items-center gap-3 border-b border-sap-border bg-sap-nested px-4 py-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sap-border bg-card text-ink-soft">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold text-foreground [overflow-wrap:anywhere]">
            {summary.title}
          </h2>
          <p className="text-meta text-ink-meta">{summary.caption}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 pb-3 pt-4">
        {summary.kind === "new" ? (
          <>
            <Figures>
              <Figure label="New" value={summary.fresh} note={summary.outOf} />
              <CategorizationFigures
                counts={summary.categories}
                accountId={accountId}
              />
            </Figures>
            {summary.problem && (
              <CategorizationNote problem={summary.problem}>
                Once that's fixed,{" "}
                <Link
                  to={reviewHref(accountId, RUN_CATEGORIZER_TAB)}
                  className="font-semibold text-attention-ink underline underline-offset-4"
                >
                  run the categoriser again
                </Link>
                .
              </CategorizationNote>
            )}
          </>
        ) : (
          <p className="text-row text-ink-meta">{summary.text}</p>
        )}
        <ClosingLine closing={summary.closing} />
        <div>
          {summary.kind === "new" && summary.byCategory.length > 0 && (
            <Disclosure summary={`By category (${summary.byCategory.length})`}>
              <FactTable rows={summary.byCategory} />
            </Disclosure>
          )}
          <Disclosure summary="Details">
            <FactTable heading="Not new because" rows={summary.notNew} />
            <FactTable rows={summary.details} />
          </Disclosure>
        </div>
      </div>
    </li>
  );
}

// The statement's closing balance as a field: the figure, and that the
// statement's transactions add up to it.
function ClosingLine({ closing }: { closing: ClosingBalance }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-t border-line-inner pt-3 text-row">
      <span className="text-ink-soft">{closing.label}</span>
      {closing.verified ? (
        <span className="flex flex-wrap items-baseline justify-end gap-x-2">
          <span className="tnum font-mono font-medium text-foreground">
            {closing.figure}
          </span>
          <span className="text-meta text-primary">
            <span aria-hidden="true">✓ </span>Transactions add up
          </span>
        </span>
      ) : (
        <span className="text-meta text-ink-meta">{closing.text}</span>
      )}
    </div>
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
            goal={agent.goal}
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
      <p className="bg-tile-bg px-4 py-2 text-[14.5px] font-semibold text-foreground">
        {problem.subject}
      </p>
      <div className="px-4 pb-1 pt-4">
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
