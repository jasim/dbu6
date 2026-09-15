import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BookOpenText,
  CirclePlus,
  FileSearch,
  FileUp,
  ListChecks,
  Scale,
  Send,
} from "lucide-react";
import { Link } from "react-router-dom";
import { usePageTitle } from "@sapporta/frontend/shell";
import { Button } from "./components/ui/button";

type WorkflowSection = {
  title: string;
  description: string;
  action: string;
  to: string;
  icon: LucideIcon;
  /** The screen's one primary button: the workflow's main action. */
  primary?: boolean;
  secondaryAction?: {
    label: string;
    to: string;
  };
};

const workflowSections: readonly WorkflowSection[] = [
  {
    title: "Set up your accounts",
    description:
      "Begin with the bank accounts and credit cards you want to import. You can also add the income and expense accounts you will use to organize their transactions.",
    action: "Add an account",
    to: "/setup/accounts/new",
    icon: CirclePlus,
    secondaryAction: {
      label: "View accounts",
      to: "/accounts",
    },
  },
  {
    title: "Find where to resume",
    description:
      "Before choosing a statement, check the last date and balance already recorded for each account. This tells you which statement should come next.",
    action: "Check the import point",
    to: "/reports/last-reconciled",
    icon: FileSearch,
  },
  {
    title: "Import the statement",
    description:
      "Drop in the statements you downloaded. Each one is matched to its bank or credit card account, and the transactions remain in draft while you check them.",
    action: "Import statements",
    to: "/import",
    icon: FileUp,
    primary: true,
  },
  {
    title: "Review the draft",
    description:
      "Now you can correct the categories and confirm that there are no duplicate transactions or balance differences. Nothing reaches the books until these checks are clear.",
    action: "Review draft entries",
    to: "/review",
    icon: ListChecks,
  },
  {
    title: "Add the entries to your books",
    description:
      "Once the draft is ready, post it. dbu6 will create the journals and balanced journal entries that appear in your ledgers and reports.",
    action: "Post reviewed entries",
    to: "/views/post-drafts",
    icon: Send,
  },
];

const bookViews = [
  {
    label: "Open an account ledger",
    to: "/reports/account-ledger",
    icon: BookOpenText,
  },
  {
    label: "View the balance sheet",
    to: "/reports/balance-sheet",
    icon: Scale,
  },
  {
    label: "Review income and expenses",
    to: "/reports/income-statement",
    icon: ListChecks,
  },
] as const;

export function Welcome() {
  usePageTitle("Home");
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[900px] px-5 py-10 sm:px-8 sm:py-12 lg:px-10 lg:py-14">
        <header className="max-w-[720px]">
          <h1 className="text-title text-foreground sm:text-display">
            Keep your books up to date
          </h1>
          <p className="mt-4 text-body text-ink-soft">
            Start with the statements from your bank and credit card accounts.
            dbu6 keeps each import in draft until you have checked it, then adds
            the finished entries to your books.
          </p>
        </header>

        <main className="mt-8 border-t border-sap-border">
          {workflowSections.map((section) => (
            <WorkflowSectionView key={section.title} section={section} />
          ))}
        </main>

        <section className="mt-10">
          <h2 className="text-heading text-foreground">
            Once the books are current
          </h2>
          <p className="mt-2 max-w-[680px] text-body text-ink-soft">
            The posted entries are now available throughout the reports. Open an
            account ledger for detail, or step back and look at your overall
            position and spending.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {bookViews.map((view) => {
              const Icon = view.icon;
              return (
                <Button
                  key={view.to}
                  render={<Link to={view.to} />}
                  nativeButton={false}
                  variant="outline"
                >
                  <Icon strokeWidth={1.8} />
                  {view.label}
                </Button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function WorkflowSectionView({ section }: { section: WorkflowSection }) {
  const Icon = section.icon;

  return (
    <section className="grid gap-5 border-b border-sap-border py-8 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center sm:gap-10">
      <div>
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-ink-meta" strokeWidth={1.8} />
          <h2 className="text-heading text-foreground">{section.title}</h2>
        </div>
        <p className="mt-3 max-w-[620px] text-body text-ink-soft">
          {section.description}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2">
        <Button
          render={<Link to={section.to} />}
          nativeButton={false}
          variant={section.primary ? "default" : "outline"}
        >
          {section.action}
          <ArrowRight strokeWidth={2} />
        </Button>
        {section.secondaryAction ? (
          <Button
            render={<Link to={section.secondaryAction.to} />}
            nativeButton={false}
            variant="ghost"
          >
            {section.secondaryAction.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
