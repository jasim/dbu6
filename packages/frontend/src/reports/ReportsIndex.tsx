import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { LinkCard } from "../components/link-card";
import {
  reportSections,
  reportsIn,
  type ReportSection,
  type ReportSubgroup,
} from "./registry";

/**
 * Where the sidebar's Reports item lands: every report, once, in sections
 * and subgroups from the report registry, most used first.
 */
export function ReportsIndex() {
  usePageTitle("Reports");
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:px-10">
        <header className="max-w-[720px] border-b border-sap-border pb-7">
          <h1 className="text-title text-foreground sm:text-display">
            Reports
          </h1>
        </header>

        <main className="space-y-12 py-8">
          {reportSections.map((section) => (
            <ReportSectionView key={section.title} section={section} />
          ))}
        </main>
      </div>
    </div>
  );
}

function ReportSectionView({ section }: { section: ReportSection }) {
  const [first, second] = section.subgroups;
  return (
    <section>
      <h2 className="text-heading text-foreground">{section.title}</h2>
      {second === undefined ? (
        <ReportCards
          subgroup={first.id}
          className="mt-4 lg:grid-cols-2 lg:gap-x-6"
        />
      ) : (
        <div className="mt-4 grid gap-8 lg:grid-cols-2 lg:gap-6">
          {section.subgroups.map((subgroup) => (
            <div key={subgroup.id}>
              <h3 className="text-label uppercase text-ink-meta">
                {subgroup.title}
              </h3>
              <ReportCards subgroup={subgroup.id} className="mt-3" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportCards({
  subgroup,
  className,
}: {
  subgroup: ReportSubgroup;
  className: string;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      {reportsIn(subgroup).map((report) => (
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
