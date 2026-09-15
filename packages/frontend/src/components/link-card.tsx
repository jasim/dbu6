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
  /** A coloured dot before the text: green for everyday, grey for accounting. */
  marker?: "everyday" | "accounting";
};

/** A card-shaped link: a name, one line on what it opens, and an arrow. */
export function LinkCard({
  label,
  description,
  to,
  icon: Icon,
  marker,
}: LinkCardProps) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-card border bg-card px-4 py-3 text-foreground no-underline transition-colors hover:bg-sap-row-hover"
    >
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted text-ink-meta">
          <Icon className="size-4" strokeWidth={1.8} />
        </span>
      )}
      {marker && (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            marker === "everyday" ? "bg-primary" : "bg-ink-meta",
          )}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-row font-semibold">{label}</span>
        <span className="mt-0.5 block truncate text-meta text-ink-meta">
          {description}
        </span>
      </span>
      <ArrowRight
        className="size-4 shrink-0 text-sap-subtle transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.8}
      />
    </Link>
  );
}
