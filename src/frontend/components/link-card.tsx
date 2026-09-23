import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";

export type LinkCardProps = {
  label: string;
  description: string;
  to: string;
  /** An icon tile before the text (All tools). */
  icon?: LucideIcon;
  /**
   * `row` (default): a list item with the name above the description.
   * `tile`: a taller card with a larger name, for the reports that lead a
   * page (the financial statements).
   */
  layout?: "row" | "tile";
};

/** A card-shaped link: a name, one line on what it opens, and an arrow. */
export function LinkCard({
  label,
  description,
  to,
  icon: Icon,
  layout = "row",
}: LinkCardProps) {
  const tile = layout === "tile";
  return (
    <Link
      to={to}
      className={cn(
        "group flex gap-3 rounded-card border bg-card text-foreground no-underline transition-colors hover:bg-sap-row-hover",
        tile ? "items-start px-4 py-3 shadow-card" : "items-center px-4 py-2",
      )}
    >
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted text-ink-meta">
          <Icon className="size-4" strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block",
            tile ? "text-subheading" : "truncate text-row font-semibold",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "block text-meta text-ink-meta",
            tile ? "mt-1.5" : "mt-0.5",
          )}
        >
          {description}
        </span>
      </span>
      <ArrowRight
        className={cn(
          "size-4 shrink-0 text-sap-subtle transition-transform group-hover:translate-x-0.5",
          tile && "mt-1.5",
        )}
        strokeWidth={1.8}
      />
    </Link>
  );
}
