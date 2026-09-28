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
 *
 * It is a caption on the work, not a control beside it: the markers are the
 * only solid thing here, and every step's name sits in the quiet ink, the
 * current one a shade darker. Whatever the user is meant to press is
 * elsewhere on the page.
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
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  step.status === "done" && "bg-primary/10 text-primary",
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
                    "mx-2 flex-1 border-t",
                    step.status === "done"
                      ? "border-primary/45"
                      : "border-dashed border-waiting-marker",
                  )}
                />
              )}
            </div>
            <div className="mt-2 pr-3">
              <div
                className={cn(
                  "text-meta font-medium",
                  step.status === "current" ? "text-ink-soft" : "text-ink-meta",
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
