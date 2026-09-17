import type { ReactNode } from "react";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { AgentPrompt } from "../components/agent-prompt";
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

/** The tab's prompt, under its report. */
export function AskYourAgent({
  title,
  prompt,
}: {
  title: string;
  prompt: string;
}) {
  return (
    <div className="mt-8 max-w-[760px]">
      <AgentPrompt
        title={title}
        prompt={prompt}
        afterwards="Nothing changes in your books until you tell the agent to."
      />
    </div>
  );
}
