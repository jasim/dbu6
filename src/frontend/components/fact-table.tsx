import type { ReactNode } from "react";
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
      <FactList>
        {rows.map((row) => (
          <FactRow key={row.label} label={row.label} face={row.face}>
            {row.value}
          </FactRow>
        ))}
      </FactList>
    </div>
  );
}

/**
 * FactTable's box, for rows built one by one: a value that carries a mark
 * or a control beside its figure.
 */
export function FactList({ children }: { children: ReactNode }) {
  return (
    <dl className="divide-y divide-line-inner rounded-control border border-sap-border">
      {children}
    </dl>
  );
}

/** One of FactTable's rows. */
export function FactRow({
  label,
  face,
  children,
}: {
  label: string;
  face?: Fact["face"];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 px-4 py-2.5 text-row">
      <dt className="min-w-0 text-ink-soft">{label}</dt>
      <dd
        className={cn(
          "ml-auto min-w-0 text-right text-foreground [overflow-wrap:anywhere]",
          face !== "words" && "tnum font-mono font-medium",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
