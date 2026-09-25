import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import type { RailMark, RailStep } from "./steps";

/*
 * The setup wizard's four steps down the left of the page: a mark, the
 * title and where the step stands, each a link to the step. On a phone it
 * is a row of the marks and titles above the step.
 */

const MARK_LABEL: Record<RailMark, string> = {
  done: "Done",
  current: "Current step",
  todo: "To do",
};

export function SetupRail({ steps }: { steps: readonly RailStep[] }) {
  return (
    <nav aria-label="Setup steps" className="md:sticky md:top-6 md:self-start">
      <ol className="grid grid-cols-4 gap-1 md:grid-cols-1 md:gap-0.5">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.to}
              aria-current={step.current ? "step" : undefined}
              className={cn(
                "flex h-full flex-col items-center gap-1.5 rounded-control px-1 py-2 text-center text-foreground no-underline outline-none transition-colors hover:bg-sap-row-hover focus-visible:ring-[3px] focus-visible:ring-ring/40",
                "md:flex-row md:items-start md:gap-2.5 md:px-3 md:text-left",
                step.current && "bg-card shadow-card hover:bg-card",
              )}
            >
              <Mark mark={step.mark} />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-meta leading-tight md:text-row",
                    step.current ? "font-semibold" : "font-medium",
                    step.mark === "todo" && !step.current && "text-ink-soft",
                  )}
                >
                  {step.title}
                </span>
                {step.status && (
                  <span className="mt-0.5 hidden text-meta text-ink-meta md:block">
                    {step.status}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** ✓ done, ● current, ○ to do; the word is for screen readers. */
function Mark({ mark }: { mark: RailMark }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-[12px] md:mt-px",
        mark === "done" && "bg-primary text-primary-foreground",
        mark === "current" && "border-[1.5px] border-attention",
        mark === "todo" && "border-[1.5px] border-waiting-marker",
      )}
    >
      <span className="sr-only">{MARK_LABEL[mark]}</span>
      {mark === "done" && <span aria-hidden="true">✓</span>}
      {mark === "current" && (
        <span aria-hidden="true" className="size-2 rounded-full bg-attention" />
      )}
    </span>
  );
}
