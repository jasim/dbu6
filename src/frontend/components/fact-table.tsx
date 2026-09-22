import { cn } from "@sapporta/ui/cn";

// A labelled fact. Values are figures (money, dates, counts, codes) set in
// mono unless marked as words.
export interface Fact {
  label: string;
  value: string;
  face?: "figure" | "words";
}

/** Labels on the left, values on the right. Figures are mono; words wrap. */
export function FactTable({
  rows,
  heading,
}: {
  rows: readonly Fact[];
  heading?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      {heading && (
        <div className="mb-2 text-label uppercase text-ink-meta">{heading}</div>
      )}
      <dl className="divide-y divide-line-inner rounded-control border border-sap-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 px-4 py-2.5 text-row"
          >
            <dt className="min-w-0 text-ink-soft">{row.label}</dt>
            <dd
              className={cn(
                "ml-auto min-w-0 text-right text-foreground [overflow-wrap:anywhere]",
                row.face !== "words" && "tnum font-mono font-medium",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
