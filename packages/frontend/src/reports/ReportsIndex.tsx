import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { LinkCard } from "../components/link-card";
import { reportGroups, reportsInGroup } from "./registry";

/**
 * Where the sidebar's Reports item lands: one card per report, in groups.
 * The financial statements lead as tiles; ledgers and checks follow side by
 * side. The cards come from the report registry, so this page and All tools
 * read one list.
 */
export function ReportsIndex() {
  usePageTitle("Reports");
  const [statements, ...details] = reportGroups;
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:px-10">
        <header className="max-w-[720px] border-b border-sap-border pb-7">
          <h1 className="text-title text-foreground sm:text-display">
            Reports
          </h1>
          <p className="mt-4 text-body text-ink-soft">
            Statements show how you're doing, ledgers show the detail, and
            checks show whether you can trust the numbers.
          </p>
        </header>

        <main className="space-y-10 py-8">
          <ReportGroupSection group={statements} layout="tile" />
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-6">
            {details.map((group) => (
              <ReportGroupSection key={group.id} group={group} layout="row" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function ReportGroupSection({
  group,
  layout,
}: {
  group: (typeof reportGroups)[number];
  layout: "row" | "tile";
}) {
  return (
    <section>
      <h2 className="text-heading text-foreground">{group.title}</h2>
      <div
        className={cn(
          "mt-4 grid",
          layout === "tile" ? "gap-3 sm:grid-cols-3" : "gap-2",
        )}
      >
        {reportsInGroup(group.id).map((report) => (
          <LinkCard
            key={report.id}
            label={report.label}
            description={report.description}
            to={report.to}
            layout={layout}
          />
        ))}
      </div>
    </section>
  );
}
