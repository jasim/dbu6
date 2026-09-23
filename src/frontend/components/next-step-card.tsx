import type { ReactNode } from "react";

/**
 * The one obvious next step. Exactly one per screen, at the top of Home. The
 * medallion carries the count so the number is read first; the body says
 * where the work came from and what is at stake. With nothing to count (a
 * first account, new statements to import) there is no medallion.
 */
export function NextStepCard({
  count,
  title,
  body,
  action,
}: {
  count?: number;
  title: string;
  body?: ReactNode;
  /** The primary button: pass a `Button` (with a `render` for a link). */
  action: ReactNode;
}) {
  return (
    <section className="flex flex-wrap items-center gap-x-[26px] gap-y-4 rounded-card border border-sap-border bg-card px-5 py-[26px] shadow-card">
      {count !== undefined && (
        <span
          aria-hidden="true"
          className="tnum flex size-10 shrink-0 items-center justify-center rounded-full border border-attention-border bg-attention-bg font-mono text-[16px] font-semibold text-attention-ink"
        >
          {count}
        </span>
      )}
      <div className="min-w-0 flex-1 basis-[280px]">
        <h2 className="text-heading text-foreground">{title}</h2>
        {body && (
          <p className="mt-[5px] max-w-[640px] text-body text-ink-soft">
            {body}
          </p>
        )}
      </div>
      <div className="shrink-0 sm:ml-auto">{action}</div>
    </section>
  );
}
