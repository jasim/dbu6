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

type WorkflowSection = {
  title: string;
  description: string;
  action: string;
  to: string;
  icon: LucideIcon;
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
      to: "/tables/accounts",
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
      "Choose the matching bank or credit card account and upload its statement. The transactions will remain in draft while you check them.",
    action: "Import a statement",
    to: "/views/import-statement",
    icon: FileUp,
  },
  {
    title: "Review the draft",
    description:
      "Now you can correct the categories and confirm that there are no duplicate transactions or balance differences. Nothing reaches the books until these checks are clear.",
    action: "Review draft entries",
    to: "/tables/draft_transactions",
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
  usePageTitle("Accounting home");
  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[900px] px-5 py-10 sm:px-8 sm:py-12 lg:px-10 lg:py-14">
        <header className="max-w-[720px]">
          <h1 className="text-[34px] font-semibold leading-tight tracking-sap-display text-sap-fg sm:text-[40px]">
            Keep your books up to date
          </h1>
          <p className="mt-4 text-sap-body leading-7 text-sap-soft">
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
          <h2 className="text-[20px] font-semibold text-sap-fg">
            Once the books are current
          </h2>
          <p className="mt-2 max-w-[680px] text-sap-body leading-6 text-sap-soft">
            The posted entries are now available throughout the reports. Open an
            account ledger for detail, or step back and look at your overall
            position and spending.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {bookViews.map((view) => {
              const Icon = view.icon;
              return (
                <Link
                  key={view.to}
                  to={view.to}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sap-border bg-sap-panel px-4 text-sap-data font-semibold text-sap-fg no-underline transition-colors hover:bg-sap-row-hover"
                >
                  <Icon className="size-4" strokeWidth={1.8} />
                  {view.label}
                </Link>
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
          <Icon className="size-5 text-sap-muted" strokeWidth={1.8} />
          <h2 className="text-[20px] font-semibold text-sap-fg">
            {section.title}
          </h2>
        </div>
        <p className="mt-3 max-w-[620px] text-sap-body leading-6 text-sap-soft">
          {section.description}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2">
        <Link
          to={section.to}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-sap-brand px-4 text-sap-data font-semibold text-sap-bg no-underline transition-opacity hover:opacity-90"
        >
          {section.action}
          <ArrowRight className="size-4" strokeWidth={2} />
        </Link>
        {section.secondaryAction ? (
          <Link
            to={section.secondaryAction.to}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-sap-border bg-sap-panel px-4 text-sap-data font-semibold text-sap-fg no-underline transition-colors hover:bg-sap-row-hover"
          >
            {section.secondaryAction.label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
