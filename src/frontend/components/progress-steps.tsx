import { cn } from "@sapporta/ui/cn";

export type StepStatus = "done" | "current" | "waiting";

export interface Step {
  /** "Statement imported" */
  title: string;
  status: StepStatus;
  /** "HDFC Savings, up to 13 Sep" */
  detail: string;
}

/**
 * The import journey as four equal cards. It says where the user is, not
 * what to do: done is a green tick, current is a blue numeral on a white-blue
 * card, waiting is a dashed marker in muted ink. Never more than one current.
 */
export function ProgressSteps({
  steps,
  label = "Progress",
}: {
  steps: readonly Step[];
  label?: string;
}) {
  return (
    <ol className="grid grid-cols-4 gap-3.5" aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={step.title}
          aria-current={step.status === "current" ? "step" : undefined}
          className={cn(
            "rounded-[14px] px-[18px] py-4",
            step.status === "done" && "border border-sap-border bg-card",
            step.status === "current" &&
              "border-[1.5px] border-attention-border bg-attention-surface px-[17px] py-[15px]",
            step.status === "waiting" &&
              "border border-dashed border-waiting-border bg-waiting-bg",
          )}
        >
          <div className="flex items-center gap-[9px]">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[12px]",
                step.status === "done" && "bg-primary text-primary-foreground",
                step.status === "current" &&
                  "tnum bg-attention font-mono text-[11px] font-semibold text-primary-foreground",
                step.status === "waiting" &&
                  "border-[1.5px] border-dashed border-waiting-marker",
              )}
            >
              {step.status === "done"
                ? "✓"
                : step.status === "current"
                  ? index + 1
                  : ""}
            </span>
            <span
              className={cn(
                "text-[15.5px] font-semibold",
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
        </li>
      ))}
    </ol>
  );
}
