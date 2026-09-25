import { cn } from "@sapporta/ui/cn";

export type Direction = "in" | "out";

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A true minus sign, not a hyphen. */
export const MINUS = "−";

/**
 * A figure with its direction made explicit: "+4,50,000.00" or
 * "−3,50,560.00", in Indian grouping.
 */
export function formatAmount(value: number, direction: Direction): string {
  const sign = direction === "in" ? "+" : MINUS;
  return `${sign}${money.format(Math.abs(value))}`;
}

const SIZES = {
  row: "text-[15px] font-medium",
  lg: "text-[17px] font-medium",
  display: "text-[33px] font-semibold tracking-[-0.02em]",
} as const;

/**
 * The money primitive. Direction is never carried by colour alone: an
 * explicit sign, an IN/OUT label under the figure, and then colour (green
 * for money in, ink for money out). Always mono and tabular, right-aligned.
 */
export function Amount({
  value,
  direction,
  size = "row",
  showLabel = true,
  className,
}: {
  value: number;
  direction: Direction;
  size?: keyof typeof SIZES;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-col items-end", className)}>
      <span
        className={cn(
          "tnum font-mono",
          SIZES[size],
          direction === "in" ? "text-money-in" : "text-foreground",
        )}
      >
        {formatAmount(value, direction)}
      </span>
      {showLabel && (
        <span className="text-label uppercase text-ink-meta">
          {direction === "in" ? "in" : "out"}
        </span>
      )}
    </span>
  );
}
