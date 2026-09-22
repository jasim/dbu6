import { useId, useState, type ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";

type DisclosureTone = "assist";

function summaryClass(tone: DisclosureTone | undefined): string {
  return cn(
    "inline-flex min-h-sap-ctl cursor-pointer list-none items-center gap-2 rounded-control text-row font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden",
    tone === "assist" ? "text-assist-ink" : "text-primary",
  );
}

/**
 * A section that starts collapsed behind a link-styled summary, with a ▸ that
 * turns to ▾ when open: technical details, a prompt's full text. Inside the
 * coding-agent panel it reads in the panel's violet, so the panel is one
 * thing; everywhere else in the app's green.
 *
 * An `aside` sits at the right of the summary's line, for quiet actions that
 * belong at the foot of a card.
 */
export function Disclosure({
  summary,
  tone,
  aside,
  children,
}: {
  summary: string;
  tone?: DisclosureTone;
  aside?: ReactNode;
  children: ReactNode;
}) {
  if (aside !== undefined) {
    return (
      <DisclosureRow summary={summary} tone={tone} aside={aside}>
        {children}
      </DisclosureRow>
    );
  }
  return (
    <details>
      {/* The markers follow their own <details> only, not an open one
          around it, so a disclosure inside another reads right. */}
      <summary className={summaryClass(tone)}>
        <span
          aria-hidden="true"
          className="w-3 text-ink-meta [details[open]>summary>&]:hidden"
        >
          ▸
        </span>
        <span
          aria-hidden="true"
          className="hidden w-3 text-ink-meta [details[open]>summary>&]:inline"
        >
          ▾
        </span>
        {summary}
      </summary>
      <div className="mb-2 mt-1 space-y-4">{children}</div>
    </details>
  );
}

// The same disclosure with something beside its summary. A <summary> can't
// share its line with anything outside the <details>, so here the summary is
// a button that shows and hides the content under the whole row.
function DisclosureRow({
  summary,
  tone,
  aside,
  children,
}: {
  summary: string;
  tone: DisclosureTone | undefined;
  aside: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      {/* Wrapped on a narrow screen, the aside goes above the summary, so
          the summary stays next to what it opens. */}
      <div className="flex flex-wrap-reverse items-center justify-between gap-x-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((was) => !was)}
          className={summaryClass(tone)}
        >
          <span aria-hidden="true" className="w-3 text-ink-meta">
            {open ? "▾" : "▸"}
          </span>
          {summary}
        </button>
        {aside}
      </div>
      <div id={id} hidden={!open} className="mb-2 mt-1 space-y-4">
        {children}
      </div>
    </div>
  );
}
