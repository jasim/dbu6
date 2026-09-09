import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BarChart3,
  Database,
  FileText,
  FileUp,
  Send,
  Settings2,
  Upload,
  Wand2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useSchemaStore } from "@sapporta/frontend/schema";
import { usePageTitle } from "@sapporta/frontend/shell";
import { reportDefinitions } from "./reports/registry";

type ToolLink = {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
};

const importTools: readonly ToolLink[] = [
  {
    label: "Universal statement import",
    description:
      "Import PDF, text, CSV, XLS, or Abacus JSON with account-specific presets.",
    to: "/views/import-statement",
    icon: FileUp,
  },
  {
    label: "HDFC statement import",
    description: "Use the dedicated HDFC Bank statement workflow.",
    to: "/views/import-hdfc-bank-statement",
    icon: Upload,
  },
  {
    label: "Federal Bank statement import",
    description: "Use the dedicated Federal Bank statement workflow.",
    to: "/views/import-federal-bank-statement",
    icon: Upload,
  },
  {
    label: "Reclassify drafts",
    description:
      "Run the configured categorizer again for uncategorized draft rows.",
    to: "/views/reclassify-drafts",
    icon: Wand2,
  },
  {
    label: "Render draft hledger",
    description: "Preview draft transactions as hledger journal text.",
    to: "/views/render-draft-hledger",
    icon: FileText,
  },
  {
    label: "Post drafts",
    description: "Convert a checked draft into journals and journal entries.",
    to: "/views/post-drafts",
    icon: Send,
  },
];

export function Advanced() {
  usePageTitle("Advanced");
  const tables = useSchemaStore((state) => state.tables);

  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:px-10">
        <header className="max-w-[720px] border-b border-sap-border pb-7">
          <div className="flex items-center gap-2 text-sap-label font-bold uppercase tracking-sap-section text-sap-brand">
            <Settings2 className="size-4" strokeWidth={1.8} />
            Advanced
          </div>
          <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-sap-display text-sap-fg sm:text-[38px]">
            Every table, report, and specialist tool
          </h1>
          <p className="mt-4 text-sap-body leading-7 text-sap-soft">
            The main sidebar follows the normal statement workflow. Use this
            page when you need direct access to the underlying accounting data
            or a less common report.
          </p>
        </header>

        <main className="grid gap-10 py-8 lg:grid-cols-2">
          <AdvancedSection
            title="Data tables"
            description="Open the source records directly. Changes here affect the books, so use the guided workflow for routine imports."
          >
            <div className="grid gap-2">
              {tables.map((table) => (
                <AdvancedLink
                  key={table.name}
                  label={table.label}
                  description={table.name}
                  to={`/tables/${table.name}`}
                  icon={Database}
                />
              ))}
            </div>
          </AdvancedSection>

          <AdvancedSection
            title="Import and posting tools"
            description="These are the individual tools behind the statement workflow."
          >
            <div className="grid gap-2">
              {importTools.map((tool) => (
                <AdvancedLink key={tool.to} {...tool} />
              ))}
            </div>
          </AdvancedSection>

          <AdvancedSection
            title="All reports"
            description="Open any available view of the posted books and draft checks."
            className="lg:col-span-2"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {reportDefinitions.map((report) => (
                <AdvancedLink
                  key={report.id}
                  label={report.label}
                  description="Accounting report"
                  to={`/reports/${report.id}`}
                  icon={BarChart3}
                />
              ))}
            </div>
          </AdvancedSection>
        </main>
      </div>
    </div>
  );
}

function AdvancedSection({
  title,
  description,
  className = "",
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <h2 className="text-[20px] font-semibold text-sap-fg">{title}</h2>
      <p className="mt-1 text-sap-data leading-5 text-sap-muted">
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AdvancedLink({ label, description, to, icon: Icon }: ToolLink) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-lg border border-sap-border bg-sap-panel px-4 py-3 text-sap-fg no-underline transition-colors hover:bg-sap-row-hover"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sap-sidebar text-sap-muted">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sap-data font-semibold">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-sap-micro text-sap-muted">
          {description}
        </span>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-sap-subtle transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.8}
      />
    </Link>
  );
}
