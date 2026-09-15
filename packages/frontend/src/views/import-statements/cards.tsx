import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Copy, Info } from "lucide-react";
import { Link } from "react-router-dom";
import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import { Button } from "../../components/ui/button";
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
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      <Copy />
      {copied ? "Copied" : "Copy prompt"}
    </Button>
  );
}

// Every result card has the same skeleton so the eye lands in the same
// places: whose statement (header), what happened (one sentence), the
// numbers (tiles or a table), then everything else.

type PillTone = "success" | "neutral" | "warning" | "danger";

const PILL_CLASSES: Record<PillTone, string> = {
  success: "bg-money-in-bg text-money-in-ink",
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-attention-bg text-attention-ink",
  danger: "bg-destructive/10 text-destructive",
};

function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-meta font-medium ${PILL_CLASSES[tone]}`}
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
        <div
          className="truncate text-row font-semibold text-foreground"
          title={title}
        >
          {title}
        </div>
        {caption && (
          <div className="break-words text-meta text-ink-meta">{caption}</div>
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
      <p className="text-subheading text-foreground">{children}</p>
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
          <dt className="text-label uppercase text-ink-meta">{stat.label}</dt>
          <dd className="tnum mt-0.5 font-mono text-row font-semibold text-foreground">
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
        <div className="mb-1.5 text-label uppercase text-ink-meta">
          {heading}
        </div>
      )}
      <dl
        className={`divide-y rounded-control border ${dense ? "text-meta" : "text-row"}`}
      >
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-6 px-3 py-1.5"
          >
            <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
            <dd className="tnum shrink-0 break-all text-right font-mono font-medium text-foreground">
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
    <div className="flex items-start gap-4 text-row">
      <div className="w-24 shrink-0 pt-0.5 text-label uppercase text-ink-meta">
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
    <div className="rounded-card border bg-card shadow-card">
      <CardHeader
        icon={
          fresh ? (
            <CheckCircle2 className="h-5 w-5 text-money-in" />
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
              <Button
                render={<Link to={REVIEW_DRAFTS_ROUTE} />}
                nativeButton={false}
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                Review drafts
              </Button>
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
              <span className="text-meta text-ink-meta">
                {summary.balances.caption}
              </span>
            )}
          </div>
        </LabelledRow>
      </div>
      <details className="border-t px-4 py-3 text-meta">
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
            <pre className="tnum mt-2 overflow-x-auto whitespace-pre rounded-control bg-muted p-3 font-mono">
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
    <div className="rounded-card border border-destructive/30 bg-card shadow-card">
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
          <p className="break-words text-row text-ink-soft">{problem.why}</p>
        </LabelledRow>
        {(problem.steps.length > 0 || problem.actions.length > 0) && (
          <LabelledRow label="What to do">
            <div className="space-y-2">
              {problem.steps.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-row text-ink-soft">
                  {problem.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
              {problem.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
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
            </div>
          </LabelledRow>
        )}
        {problem.agent && (
          <details>
            <summary className="cursor-pointer text-row font-medium text-primary hover:underline">
              Ask your coding agent to sort this out
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-row text-ink-soft">
                Copy this prompt into your coding agent, running in the app's
                repository. {problem.agent.afterwards}
              </p>
              <CopyPromptButton text={problem.agent.prompt} />
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-3 font-mono text-meta">
                {problem.agent.prompt}
              </pre>
            </div>
          </details>
        )}
        {problem.technical && (
          <details className="text-meta">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Technical details
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-control bg-muted p-2 font-mono">
              {problem.technical}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
