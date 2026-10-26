import {
  ClipboardPaste,
  Database,
  FileArchive,
  FileText,
  FileUp,
  Settings2,
} from "lucide-react";
import { useSchemaStore } from "@sapporta/frontend/schema";
import { usePageTitle } from "@sapporta/frontend/shell";
import { LinkCard, type LinkCardProps } from "./components/link-card";

const importTools: readonly LinkCardProps[] = [
  {
    label: "Import statements",
    description:
      "Import PDF, CSV, or XLS statements, each matched to its account by a saved parser and import preset.",
    to: "/import",
    icon: FileUp,
  },
  {
    label: "Import freeform transactions",
    description:
      "Paste transactions as text and let the agent turn them into draft rows.",
    to: "/views/import-freeform-transactions",
    icon: ClipboardPaste,
  },
  {
    label: "Render draft hledger",
    description: "Preview draft transactions as hledger journal text.",
    to: "/views/render-draft-hledger",
    icon: FileText,
  },
];

export function Advanced() {
  usePageTitle("All tools");
  const tables = useSchemaStore((state) => state.tables);

  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="max-w-[720px] border-b border-sap-border pb-4">
          <div className="flex items-center gap-2 text-label uppercase text-primary">
            <Settings2 className="size-4" strokeWidth={1.8} />
            All tools
          </div>
          <h1 className="mt-3 text-title text-foreground sm:text-display">
            Every table and specialist tool
          </h1>
        </header>

        <div className="grid gap-6 py-8 lg:grid-cols-2">
          <LinkCard
            layout="tile"
            accent
            label="Export your books as plain text (hledger)"
            description="Download your entire books as human-readable .journal files, ready to open in any text editor or run with hledger."
            to="/views/export-hledger"
            icon={FileArchive}
          />
        </div>

        <main className="grid gap-6 border-t border-sap-border py-5 lg:grid-cols-2">
          <AdvancedSection
            title="Data tables"
            description="Direct access to all dbu6 tables"
          >
            <div className="grid gap-2">
              {tables.map((table) => (
                <LinkCard
                  key={table.name}
                  label={table.label}
                  description={table.name}
                  to={`/tables/${table.name}`}
                  icon={Database}
                />
              ))}
            </div>
          </AdvancedSection>

          <AdvancedSection title="Import and posting tools">
            <div className="grid gap-2">
              {importTools.map((tool) => (
                <LinkCard key={tool.to} {...tool} />
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
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-heading text-foreground">{title}</h2>
      {description && (
        <p className="mt-1 text-meta text-ink-meta">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}
