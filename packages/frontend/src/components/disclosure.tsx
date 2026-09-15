import type { ReactNode } from "react";

/**
 * A section that starts collapsed behind a link-styled summary, with a ▸ that
 * turns to ▾ when open: technical details, a prompt's full text.
 */
export function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group/disclosure">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control text-row font-semibold text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="w-3 text-ink-meta group-open/disclosure:hidden"
        >
          ▸
        </span>
        <span
          aria-hidden="true"
          className="hidden w-3 text-ink-meta group-open/disclosure:inline"
        >
          ▾
        </span>
        {summary}
      </summary>
      <div className="mb-2 mt-1 space-y-4">{children}</div>
    </details>
  );
}
