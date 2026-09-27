import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";

export type StepStatus = "done" | "current" | "waiting";

export interface Step {
  /** "Statement imported" */
  title: string;
  status: StepStatus;
  /** "HDFC Savings, up to 13 Sep" */
  detail: string;
  /** Where the step is done, when the card is a link to it. */
  to?: string;
}

// Side by side from a small screen up; stacked on a phone.
const COLUMNS = {
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

/**
 * A journey as three or four equal cards, such as a draft's way into the
 * books. It says where the user is, not what to do; a step with `to` links
 * there: done is a green tick, current is a blue dot in a ring on a
 * white-blue card, waiting is a dashed marker in muted ink. Never more than one current.
 */
export function ProgressSteps({
  steps,
  label = "Progress",
}: {
  steps: readonly Step[];
  label?: string;
}) {
  return (
    <ol
      className={cn(
        "grid gap-3.5",
        steps.length === 3 ? COLUMNS[3] : COLUMNS[4],
      )}
      aria-label={label}
    >
      {steps.map((step) => (
        <li
          key={step.title}
          aria-current={step.status === "current" ? "step" : undefined}
          className={cn(
            "rounded-card px-3 py-2",
            step.status === "done" && "border border-sap-border bg-card",
            step.status === "current" &&
              "border-[1.5px] border-attention-border bg-attention-surface px-[17px] py-[15px]",
            step.status === "waiting" &&
              "border border-dashed border-waiting-border bg-waiting-bg",
          )}
        >
          <StepLink to={step.to}>
            <div className="flex items-center gap-[9px]">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[12px]",
                  step.status === "done" &&
                    "bg-primary text-primary-foreground",
                  step.status === "current" &&
                    "border-[1.5px] border-attention",
                  step.status === "waiting" &&
                    "border-[1.5px] border-dashed border-waiting-marker",
                )}
              >
                {step.status === "done" && "✓"}
                {step.status === "current" && (
                  <span className="size-2 rounded-full bg-attention" />
                )}
              </span>
              <span
                className={cn(
                  "text-[13.5px] font-semibold",
                  step.status === "waiting" && "text-ink-meta",
                )}
              >
                {step.title}
              </span>
            </div>
            <div
              className={cn(
                "mt-[9px] text-meta",
                step.status === "current"
                  ? "font-medium text-attention-ink"
                  : "text-ink-meta",
              )}
            >
              {step.detail}
            </div>
          </StepLink>
        </li>
      ))}
    </ol>
  );
}

function StepLink({ to, children }: { to?: string; children: ReactNode }) {
  if (to === undefined) return <>{children}</>;
  return (
    <Link
      to={to}
      className="block rounded-control text-foreground no-underline outline-none hover:[&_span]:underline hover:[&_span]:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {children}
    </Link>
  );
}
