import type { ReactNode } from "react";
import type { DateSpan } from "dbu6-shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@sapporta/ui/tooltip";
import { barHeight, chartScale, type ChartBar } from "./chart";

/**
 * Month by month: a pair of bars per month (or financial year), income green
 * and spending ink on one scale. Each pair is a button; its figures show on
 * hover and focus and are its accessible name, and clicking it narrows the
 * page to its dates.
 */
export function MonthChart({
  bars,
  onSelect,
}: {
  bars: readonly ChartBar[];
  onSelect: (dates: DateSpan) => void;
}) {
  const scale = chartScale(bars);
  return (
    <ChartCard>
      <div className="-mx-2 mt-5 overflow-x-auto px-2 pb-1">
        <ol className="flex min-w-full">
          {bars.map((bar) => (
            <li key={bar.key} className="flex min-w-[42px] flex-1">
              <Tooltip>
                <TooltipTrigger
                  delay={0}
                  closeDelay={0}
                  aria-label={bar.description}
                  onClick={() => onSelect(bar.dates)}
                  className="group flex w-full flex-col items-center rounded-control px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <span className="flex h-[132px] w-full items-end justify-center gap-[3px] border-b border-sap-border-strong transition-colors duration-150 group-hover:bg-muted">
                    <Bar value={bar.income} scale={scale} tone="income" />
                    <Bar value={bar.spending} scale={scale} tone="spending" />
                  </span>
                  <span className="mt-2 text-meta text-ink-soft">
                    {bar.label}
                  </span>
                  <span className="min-h-[20px] text-meta text-ink-meta">
                    {bar.year}
                  </span>
                  {bar.soFar && (
                    <span className="text-meta text-ink-meta">so far</span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top" className="tnum font-mono">
                  {bar.description}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ol>
      </div>
    </ChartCard>
  );
}

/** The chart's card while its figures load. */
export function MonthChartSkeleton() {
  return (
    <ChartCard>
      <div
        aria-hidden="true"
        className="mt-5 h-[132px] rounded-control bg-sap-nested"
      />
    </ChartCard>
  );
}

function ChartCard({ children }: { children: ReactNode }) {
  return (
    <section className="mt-5 rounded-card border border-sap-border bg-card px-6 py-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2 className="text-subheading text-foreground">Month by month</h2>
        <ul className="flex gap-5 text-meta text-ink-soft">
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px] bg-money-in"
            />
            Income
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px] bg-foreground"
            />
            Spending
          </li>
        </ul>
      </div>
      {children}
    </section>
  );
}

function Bar({
  value,
  scale,
  tone,
}: {
  value: number;
  scale: number;
  tone: "income" | "spending";
}) {
  const height = barHeight(value, scale);
  return (
    <span
      aria-hidden="true"
      className={
        tone === "income"
          ? "w-[34%] max-w-[26px] rounded-t-[3px] bg-money-in"
          : "w-[34%] max-w-[26px] rounded-t-[3px] bg-foreground"
      }
      // A sliver stays visible; nothing at all draws nothing.
      style={{ height: height > 0 ? `max(2px, ${height * 100}%)` : 0 }}
    />
  );
}
