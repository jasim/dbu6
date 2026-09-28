import { cn } from "@sapporta/ui/cn";

export type StepStatus = "done" | "current" | "waiting";

export interface Step {
  /** "Statement imported" */
  title: string;
  status: StepStatus;
  /** "HDFC Savings, up to 13 Sep" */
  detail: string;
}

const STATUS_TEXT: Record<StepStatus, string> = {
  done: "Done",
  current: "Current step",
  waiting: "Not yet",
};

/**
 * A journey as a stepper, such as a draft's way into the books: markers
 * joined by a line, each step's name and detail under its marker. It says
 * where the user is, not where to go, so nothing in it is a control: done is
 * a green tick, current is a blue dot in a ring, waiting is a dashed marker
 * in muted ink. The line is solid up to the current step. Never more than
 * one current.
 */
export function ProgressSteps({
  steps,
  label = "Progress",
}: {
  steps: readonly Step[];
  label?: string;
}) {
  return (
    <ol className="flex" aria-label={label}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={step.title}
            aria-current={step.status === "current" ? "step" : undefined}
            className="min-w-0 flex-1"
          >
            <div className="flex items-center">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
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
                  <span className="size-2.5 rounded-full bg-attention" />
                )}
              </span>
              {!last && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-2 flex-1 border-t-[1.5px]",
                    step.status === "done"
                      ? "border-primary"
                      : "border-dashed border-waiting-marker",
                  )}
                />
              )}
            </div>
            <div className="mt-2 pr-3">
              <div
                className={cn(
                  "text-[13.5px] font-semibold",
                  step.status === "current" && "text-attention-ink",
                  step.status === "waiting" && "text-ink-meta",
                )}
              >
                <span className="sr-only">{STATUS_TEXT[step.status]}: </span>
                {step.title}
              </div>
              <div className="mt-0.5 text-meta text-ink-meta">
                {step.detail}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
