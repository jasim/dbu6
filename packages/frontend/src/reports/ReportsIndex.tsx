import { usePageTitle } from "@sapporta/frontend/shell";
import { LinkCard } from "../components/link-card";
import { reportCards, type ReportGroup } from "./registry";

/**
 * Where the sidebar's Reports item lands: every report, the everyday ones
 * first. The cards come from the report registry, so this page and All tools
 * read one list.
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
          <p className="mt-4 text-body text-ink-soft">
            Every report dbu6 can show. The everyday ones use plain words; the
            accounting view shows the same books the way a bookkeeper would.
          </p>
        </header>

        <main className="py-8">
          <ReportGroupSection title="Everyday" group="everyday" />
          <hr className="my-10 border-0 border-t border-sap-border" />
          <ReportGroupSection title="Accounting view" group="accounting" />
        </main>
      </div>
    </div>
  );
}

function ReportGroupSection({
  title,
  group,
}: {
  title: string;
  group: ReportGroup;
}) {
  return (
    <section>
      <h2 className="text-heading text-foreground">{title}</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {reportCards(group).map((card) => (
          <LinkCard key={card.id} {...card} marker={group} />
        ))}
      </div>
    </section>
  );
}
