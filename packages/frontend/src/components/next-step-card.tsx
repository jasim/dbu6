import type { ReactNode } from "react";

/**
 * The one obvious next step. Exactly one per screen, at the top of Home. The
 * medallion carries the count so the number is read first; the body says
 * where the work came from and what is at stake.
 */
export function NextStepCard({
  count,
  title,
  body,
  action,
}: {
  count: number;
  title: string;
  body: string;
  /** The primary button: pass a `Button` (with a `render` for a link). */
  action: ReactNode;
}) {
  return (
    <section className="flex items-center gap-[26px] rounded-card border border-sap-border bg-card px-7 py-[26px] shadow-card">
      <span
        aria-hidden="true"
        className="tnum flex size-[52px] shrink-0 items-center justify-center rounded-full border border-attention-border bg-attention-bg font-mono text-[19px] font-semibold text-attention-ink"
      >
        {count}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-heading text-foreground">{title}</h2>
        <p className="mt-[5px] max-w-[640px] text-body text-ink-soft">{body}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </section>
  );
}
