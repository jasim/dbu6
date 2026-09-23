import type { ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";

/**
 * A dashed box with no illustration and no exclamation. It says what the
 * screen is for and offers the one action that fills it: nothing to review,
 * no statements yet, a report with no data in the chosen dates, no results.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  /** An outline `Button`, when there is something to do. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-dashed border-sap-border-strong bg-card px-4 py-6 text-center",
        className,
      )}
    >
      <div className="text-subheading text-foreground">{title}</div>
      <p className="mx-auto mt-1.5 max-w-[420px] text-body text-ink-soft">
        {body}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
