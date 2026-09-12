import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Copy, Info } from "lucide-react";
import { Link } from "react-router-dom";
import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import { describeGroup, REVIEW_DRAFTS_ROUTE, type Stat } from "./describeGroup";
import type { Problem, ProblemAction } from "./describeProblems";

export function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-nested"
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}

// Every result card has the same skeleton so the eye lands in the same
// places: whose statement (header), what happened (one sentence), the
// numbers (tiles or a table), then everything else.

type PillTone = "success" | "neutral" | "warning" | "danger";

const PILL_CLASSES: Record<PillTone, string> = {
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  neutral: "bg-nested text-muted-foreground",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
};

function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function CardHeader({
  icon,
  title,
  caption,
  pill,
}: {
  icon: ReactNode;
  title: string;
  caption: string | null;
  pill: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold" title={title}>
          {title}
        </div>
        {caption && (
          <div className="break-words text-xs text-muted-foreground">
            {caption}
          </div>
        )}
      </div>
      {pill}
    </div>
  );
}

function Verdict({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-lg font-medium leading-snug">{children}</p>
      {action}
    </div>
  );
}

// Headline numbers, each one a label over a value.
function StatTiles({ stats }: { stats: Stat[] }) {
  if (stats.length === 0) return null;
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-4 gap-y-3">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Secondary facts as a two-column table: label left, value right.
function FactTable({
  rows,
  heading,
  dense = false,
}: {
  rows: Stat[];
  heading?: string;
  dense?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      {heading && (
        <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          {heading}
        </div>
      )}
      <dl
        className={`divide-y rounded-md border ${dense ? "text-xs" : "text-sm"}`}
      >
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-6 px-3 py-1.5"
          >
            <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 break-all text-right font-medium tabular-nums">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// A labelled row for anything that is a status rather than a number.
function LabelledRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 text-sm">
      <div className="w-24 shrink-0 pt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AccountCard({
  group,
  sources = [],
}: {
  group: AutoImportGroupResult;
  // The batch's file rows, for the institution and account number.
  sources?: readonly AutoImportPlanFile[];
}) {
  const summary = describeGroup(group, sources);
  const journal = group.result.hledger_journal;
  const fresh = summary.tone === "new";
  return (
    <div className="rounded-md border">
      <CardHeader
        icon={
          fresh ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <Info className="h-5 w-5 text-muted-foreground" />
          )
        }
        title={summary.title}
        caption={summary.caption}
        pill={
          <Pill tone={fresh ? "success" : "neutral"}>
            {fresh ? "Imported" : "Nothing new"}
          </Pill>
        }
      />
      <div className="space-y-4 px-4 py-4">
        <Verdict
          action={
            fresh && (
              <Link
                to={REVIEW_DRAFTS_ROUTE}
                className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                Review drafts
              </Link>
            )
          }
        >
          {summary.verdict}
        </Verdict>
        <StatTiles stats={summary.stats} />
        <FactTable rows={summary.breakdown} heading="Not new because" />
        <LabelledRow label="Balances">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Pill
              tone={
                summary.balances.tone === "verified" ? "success" : "warning"
              }
            >
              {summary.balances.text}
            </Pill>
            {summary.balances.caption && (
              <span className="text-xs text-muted-foreground">
                {summary.balances.caption}
              </span>
            )}
          </div>
        </LabelledRow>
        {summary.warnings.length > 0 && (
          <LabelledRow label="Warnings">
            <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </LabelledRow>
        )}
      </div>
      <details className="border-t px-4 py-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Details
        </summary>
        <div className="mt-3">
          <FactTable rows={summary.details} dense />
        </div>
        {journal && (
          <details className="mt-3">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Journal entries (hledger format)
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-nested p-3 font-mono">
              {journal}
            </pre>
          </details>
        )}
      </details>
    </div>
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
    <div className="rounded-md border border-destructive/50">
      <CardHeader
        icon={<AlertCircle className="h-5 w-5 text-destructive" />}
        title={problem.subject}
        caption={problem.caption}
        pill={<Pill tone="danger">Not imported</Pill>}
      />
      <div className="space-y-4 px-4 py-4">
        <Verdict>{problem.verdict}</Verdict>
        <FactTable rows={problem.facts} />
        <LabelledRow label="Why">
          <p className="break-words text-sm text-muted-foreground">
            {problem.why}
          </p>
        </LabelledRow>
        {(problem.steps.length > 0 || problem.actions.length > 0) && (
          <LabelledRow label="What to do">
            <div className="space-y-2">
              {problem.steps.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {problem.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
              {problem.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {problem.actions.map((action) =>
                    action.kind === "link" ? (
                      <Link
                        key={action.label}
                        to={action.to}
                        className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-nested"
                      >
                        {action.label}
                      </Link>
                    ) : (
                      <button
                        key={action.label}
                        type="button"
                        onClick={() => onAction(action)}
                        className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-nested"
                      >
                        {action.label}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          </LabelledRow>
        )}
        {problem.agent && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
              Ask your coding agent to sort this out
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-sm text-muted-foreground">
                Copy this prompt into your coding agent, running in the app's
                repository. {problem.agent.afterwards}
              </p>
              <CopyPromptButton text={problem.agent.prompt} />
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-nested p-3 font-mono text-xs">
                {problem.agent.prompt}
              </pre>
            </div>
          </details>
        )}
        {problem.technical && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Technical details
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-nested p-2">
              {problem.technical}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
