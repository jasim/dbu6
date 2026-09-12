import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Info } from "lucide-react";
import { Link } from "react-router-dom";
import type { AutoImportGroupResult } from "dbu6-shared";
import { describeGroup, REVIEW_DRAFTS_ROUTE } from "./describeGroup";
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

// One account's import, headline first, money second, breakdown behind a
// disclosure.
export function AccountCard({ group }: { group: AutoImportGroupResult }) {
  const summary = describeGroup(group);
  const journal = group.result.hledger_journal;
  return (
    <div className="rounded-md border">
      <div className="space-y-2 px-4 py-4">
        <div className="flex items-start gap-3">
          <CheckCircle2
            className={`mt-0.5 h-5 w-5 shrink-0 ${
              summary.tone === "new"
                ? "text-green-600"
                : "text-muted-foreground"
            }`}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-base font-medium">{summary.headline}</div>
            <div className="break-words text-xs text-muted-foreground">
              {summary.subline}
            </div>
            {summary.alreadyKnown.length > 0 && (
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {summary.alreadyKnown.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          {summary.tone === "new" && (
            <Link
              to={REVIEW_DRAFTS_ROUTE}
              className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Review them
            </Link>
          )}
        </div>
        <div
          className={`flex items-start gap-2 text-sm ${
            summary.money.tone === "verified"
              ? "text-green-700 dark:text-green-400"
              : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {summary.money.tone === "verified" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{summary.money.text}</span>
        </div>
        {summary.warnings.length > 0 && (
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
            {summary.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
      <details className="border-t px-4 py-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Details
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {summary.details.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="break-all tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
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

// One thing that stopped the import: what happened, why, what the user can
// do, and the prompt for their coding agent.
export function ProblemCard({
  problem,
  onAction,
}: {
  problem: Problem;
  onAction: (action: ProblemAction) => void;
}) {
  return (
    <div className="rounded-md border border-destructive/50">
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="break-words text-base font-medium">
              {problem.title}
            </div>
            <p className="break-words text-sm text-muted-foreground">
              {problem.why}
            </p>
          </div>
        </div>
        {(problem.steps.length > 0 || problem.actions.length > 0) && (
          <div className="space-y-2 pl-8">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What you can do
            </div>
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
        )}
        {problem.agent && (
          <details className="pl-8">
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
          <details className="pl-8 text-xs">
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
