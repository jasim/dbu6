import type { ReactNode } from "react";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { AgentPromptActions } from "../components/agent-prompt-actions";
import { Disclosure } from "../components/disclosure";
import { LoadError } from "../components/load-error";
import { ReportResultBody, useReportResult } from "../reports/shared";

/*
 * The parts the Duplicates and Balance checks tabs share (PLAN.md §11 P3):
 * a summary, the draft report narrowed to the account, and a prompt for the
 * user's coding agent.
 */

/** The tab's content, clear of the frame's edges. */
export function ReportTab({ children }: { children: ReactNode }) {
  return <div className="px-5 pb-10 pt-6 sm:px-8 lg:px-14">{children}</div>;
}

export function ReportSummary({ children }: { children: ReactNode }) {
  return <p className="max-w-[760px] text-body text-ink-soft">{children}</p>;
}

/** The report's grid, fetched when the tab opens. */
export function AccountReport({
  report: reportName,
  call,
  accountId,
}: {
  /** The report's id, which with the account keys the fetch. */
  report: string;
  call: () => Promise<GridDataset>;
  accountId: number;
}) {
  const report = useReportResult([reportName, accountId], call);
  if (report.error) {
    return (
      <div className="mt-5 max-w-[760px]">
        <LoadError
          title="Couldn't load the report"
          message={report.error}
          retry={report.run}
        />
      </div>
    );
  }
  return (
    <div className="mt-5 overflow-hidden rounded-card border border-sap-border bg-card">
      {report.result === null ? (
        <div aria-hidden="true" className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[40px] rounded-control bg-sap-nested" />
          ))}
        </div>
      ) : (
        <ReportResultBody error={null} result={report.result} />
      )}
    </div>
  );
}

export function AskYourAgent({ prompt }: { prompt: string }) {
  return (
    <section className="mt-8 max-w-[760px]">
      <h2 className="text-subheading text-foreground">
        Ask your coding agent to find out
      </h2>
      <p className="mt-1.5 text-body text-ink-soft">
        Open this prompt in your coding agent, or copy it into the agent running
        in the app's repository. It lists every row above and says how to read
        the rest.
      </p>
      <div className="mt-3">
        <AgentPromptActions prompt={prompt} />
      </div>
      <div className="mt-2">
        <Disclosure summary="Preview the prompt">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-control bg-muted p-3 font-mono text-meta">
            {prompt}
          </pre>
        </Disclosure>
      </div>
    </section>
  );
}
