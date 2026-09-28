import {
  cn,
  type ReactNode,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
} from "../../report-kit";
import { barHeight, chartScale, type ChartBar } from "./chart";
import { signedAmount, type Section } from "./figures";
import { shadeColor, shades } from "./shade";

/** An account's bars, drawn in place of income and spending. */
export type AccountSeries = {
  name: string;
  section: Section;
  /** One amount per bar. */
  values: readonly number[];
};

/**
 * Month by month: a pair of bars per month (or financial year), income green
 * and spending ink on one scale; or, while an account is in focus, that
 * account's bars and its average. Each bar is a button; its figures show on
 * hover and focus and are its accessible name. Clicking one selects it, so
 * the accounts and the entries narrow to it; clicking it again lets go.
 */
export function MonthChart({
  bars,
  selected,
  onSelect,
  series,
  onClearSeries,
}: {
  bars: readonly ChartBar[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  series: AccountSeries | null;
  onClearSeries: () => void;
}) {
  const scale = series ? Math.max(0, ...series.values) : chartScale(bars);
  const average =
    series && series.values.length > 0
      ? series.values.reduce((sum, value) => sum + value, 0) /
        series.values.length
      : null;
  const selectedBar = bars.find((bar) => bar.key === selected) ?? null;
  // Each series shaded on its own: the heaviest month deepest.
  const incomeShades = shades(bars.map((bar) => bar.income));
  const spendingShades = shades(bars.map((bar) => bar.spending));
  const seriesShades = series ? shades(series.values) : [];

  return (
    <ChartCard
      title={
        series ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{series.name}</span>{" "}
            <span className="shrink-0 text-ink-meta">by month</span>
            <button
              type="button"
              onClick={onClearSeries}
              aria-label="Show income and spending"
              title="Show income and spending"
              className="grid size-6 shrink-0 place-items-center rounded-control text-ink-meta outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </span>
        ) : (
          "Month by month"
        )
      }
      legend={
        series ? (
          average !== null && (
            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="w-4 border-t-2 border-dashed border-ink-meta"
              />
              <span className="tnum font-mono">
                Average {signedAmount(series.section, average)}
              </span>
            </li>
          )
        ) : (
          <>
            <LegendItem section="income">Income</LegendItem>
            <LegendItem section="spending">Spending</LegendItem>
          </>
        )
      }
      selected={
        selectedBar && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex h-7 items-center gap-1.5 rounded-full border border-sap-border-strong bg-card pl-3 pr-2 text-meta text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
            title="Show every month (Esc)"
          >
            {selectedBar.name}
            <X className="size-3.5 text-ink-meta" aria-hidden="true" />
          </button>
        )
      }
    >
      <div className="-mx-2 mt-3 overflow-x-auto px-2 pb-1">
        <ol className="flex min-w-full">
          {bars.map((bar, index) => {
            const dimmed = selected !== null && bar.key !== selected;
            const isSelected = bar.key === selected;
            const description = series
              ? `${bar.name} · ${series.name} ${signedAmount(series.section, series.values[index] ?? 0)}`
              : bar.description;
            return (
              <li key={bar.key} className="flex min-w-[42px] flex-1">
                <Tooltip>
                  <TooltipTrigger
                    delay={0}
                    closeDelay={0}
                    aria-label={description}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(isSelected ? null : bar.key)}
                    className="group flex w-full flex-col items-center rounded-control px-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <span
                      className={cn(
                        "relative flex h-[116px] w-full items-end justify-center gap-[3px] rounded-t-control border-b border-sap-border-strong transition-colors duration-150 group-hover:bg-muted",
                        isSelected && "bg-muted",
                      )}
                    >
                      {average !== null && scale > 0 && (
                        // The average, a dashed line across every bar.
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute -inset-x-1 z-10 border-t border-dashed border-ink-meta"
                          style={{ bottom: `${(average / scale) * 100}%` }}
                        />
                      )}
                      {series ? (
                        <Bar
                          value={series.values[index] ?? 0}
                          scale={scale}
                          tone={series.section}
                          shade={seriesShades[index] ?? null}
                          dimmed={dimmed}
                          wide
                        />
                      ) : (
                        <>
                          <Bar
                            value={bar.income}
                            scale={scale}
                            tone="income"
                            shade={incomeShades[index] ?? null}
                            dimmed={dimmed}
                          />
                          <Bar
                            value={bar.spending}
                            scale={scale}
                            tone="spending"
                            shade={spendingShades[index] ?? null}
                            dimmed={dimmed}
                          />
                        </>
                      )}
                    </span>
                    <span
                      className={cn(
                        "mt-2 text-meta",
                        isSelected
                          ? "font-semibold text-foreground"
                          : "text-ink-soft",
                      )}
                    >
                      {bar.label}
                    </span>
                    <span className="min-h-[20px] text-meta text-ink-meta">
                      {bar.soFar ? "so far" : bar.year}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="tnum font-mono">
                    {description}
                  </TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ol>
      </div>
    </ChartCard>
  );
}

/** The chart's card while its figures load. */
export function MonthChartSkeleton() {
  return (
    <ChartCard title="Month by month">
      <div
        aria-hidden="true"
        className="mt-3 h-[116px] rounded-control bg-sap-nested"
      />
    </ChartCard>
  );
}

function ChartCard({
  title,
  legend,
  selected,
  children,
}: {
  title: ReactNode;
  legend?: ReactNode;
  selected?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5 rounded-card border border-sap-border bg-card px-4 py-3 shadow-card">
      <div className="flex min-h-7 flex-wrap items-center gap-x-6 gap-y-2">
        <h2 className="min-w-0 text-subheading text-foreground">{title}</h2>
        <ul className="flex gap-5 text-meta text-ink-soft">{legend}</ul>
        <div className="ml-auto">{selected}</div>
      </div>
      {children}
    </section>
  );
}

/** A series' name beside its hue, light to deep. */
function LegendItem({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-2.5 w-5 rounded-[3px]"
        style={{
          background: `linear-gradient(to right, ${shadeColor(section, 0)}, ${shadeColor(section, 1)})`,
        }}
      />
      {children}
    </li>
  );
}

function Bar({
  value,
  scale,
  tone,
  shade,
  dimmed,
  wide = false,
}: {
  value: number;
  scale: number;
  tone: Section;
  shade: number | null;
  dimmed: boolean;
  wide?: boolean;
}) {
  const height = barHeight(value, scale);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "rounded-t-[3px] transition-opacity duration-150",
        wide ? "w-[56%] max-w-[36px]" : "w-[34%] max-w-[26px]",
        dimmed && "opacity-25",
      )}
      style={{
        // A sliver stays visible; nothing at all draws nothing.
        height: height > 0 ? `max(2px, ${height * 100}%)` : 0,
        background: shade === null ? undefined : shadeColor(tone, shade),
      }}
    />
  );
}
