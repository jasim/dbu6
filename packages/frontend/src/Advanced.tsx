import {
  ClipboardPaste,
  Database,
  FileText,
  FileUp,
  Settings2,
  Wand2,
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
];

export function Advanced() {
  usePageTitle("All tools");
  const tables = useSchemaStore((state) => state.tables);

  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:px-10">
        <header className="max-w-[720px] border-b border-sap-border pb-7">
          <div className="flex items-center gap-2 text-label uppercase text-primary">
            <Settings2 className="size-4" strokeWidth={1.8} />
            All tools
          </div>
          <h1 className="mt-3 text-title text-foreground sm:text-display">
            Every table and specialist tool
          </h1>
          <p className="mt-4 text-body text-ink-soft">
            The main sidebar follows the normal statement workflow. Use this
            page when you need direct access to the underlying accounting data.
          </p>
        </header>

        <main className="grid gap-10 py-8 lg:grid-cols-2">
          <AdvancedSection
            title="Data tables"
            description="Open the source records directly. Changes here affect the books, so use the guided workflow for routine imports."
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

          <AdvancedSection
            title="Import and posting tools"
            description="These are the individual tools behind the statement workflow."
          >
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
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-heading text-foreground">{title}</h2>
      <p className="mt-1 text-meta text-ink-meta">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
