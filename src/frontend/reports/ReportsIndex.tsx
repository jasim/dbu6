import { useState } from "react";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { LinkCard } from "../components/link-card";
import { Button } from "../components/ui/button";
import { CreateReport } from "./CreateReport";
import {
  reportSections,
  reportsIn,
  type ListedReport,
  type ReportDefinition,
  type ReportSection,
} from "./registry";

/**
 * Where the sidebar's Reports item lands: every report, once, in sections
 * and subgroups from the report registry, most used first.
 */
export function ReportsIndex({
  reports,
}: {
  reports: readonly ReportDefinition[];
}) {
  usePageTitle("Reports");
  const yours = reportsIn(reports, null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:px-10">
        <header className="max-w-[720px] border-b border-sap-border pb-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-title text-foreground sm:text-display">
              Reports
            </h1>
            <Button
              variant="outline"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
            >
              Create a report
            </Button>
          </div>
          {creating ? (
            <CreateReport takenIds={reports.map((report) => report.id)} />
          ) : null}
        </header>

        <main className="space-y-12 py-8">
          {reportSections.map((section) => (
            <ReportSectionView
              key={section.title}
              section={section}
              reports={reports}
            />
          ))}
          {yours.length > 0 ? (
            <section>
              <h2 className="text-heading text-foreground">Your reports</h2>
              <ReportCards
                reports={yours}
                className="mt-4 lg:grid-cols-2 lg:gap-x-6"
              />
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function ReportSectionView({
  section,
  reports,
}: {
  section: ReportSection;
  reports: readonly ReportDefinition[];
}) {
  const [first, second] = section.subgroups;
  return (
    <section>
      <h2 className="text-heading text-foreground">{section.title}</h2>
      {second === undefined ? (
        <ReportCards
          reports={reportsIn(reports, first.id)}
          className="mt-4 lg:grid-cols-2 lg:gap-x-6"
        />
      ) : (
        <div className="mt-4 grid gap-8 lg:grid-cols-2 lg:gap-6">
          {section.subgroups.map((subgroup) => (
            <div key={subgroup.id}>
              <h3 className="text-label uppercase text-ink-meta">
                {subgroup.title}
              </h3>
              <ReportCards
                reports={reportsIn(reports, subgroup.id)}
                className="mt-3"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportCards({
  reports,
  className,
}: {
  reports: readonly ListedReport[];
  className: string;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      {reports.map((report) => (
        <LinkCard
          key={report.id}
          label={report.label}
          description={report.description}
          to={report.to}
          layout={report.layout}
        />
      ))}
    </div>
  );
}
