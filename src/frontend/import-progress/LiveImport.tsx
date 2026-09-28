import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { ApiError } from "@sapporta/shared/client";
import { cn } from "@sapporta/ui/cn";
import type {
  ChartOfAccounts,
  ImportProgressReport,
  LlmStatus,
} from "../../shared/index";
import { chartOfAccountsQuery } from "../queries";
import { elapsed, importingSteps, type ImportingStep } from "./importing-steps";
import { huesByName } from "./live-ledger";
import { LiveLedger, prefersStill, useLiveReveal } from "./LiveLedger";

/*
 * A running import as it goes, wherever one is waited on (/add's card,
 * /import's page): each step as the server reports it, and the rows in a
 * live ledger, each account landing as it is answered, with the time it
 * has taken. The import is sent with a fresh `progress_id`
 * (`newProgressId`), which this polls by.
 */

/** A fresh name for one import, which its progress is asked by. */
export function newProgressId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * What the screen does once the import has answered, before it moves on:
 * reads the import's last word and shows the answers its last look missed.
 * The import's sender waits on it.
 */
export type Finale = () => Promise<void>;

// Often enough that each of the agent's answers shows as it lands.
const POLL_MS = 700;

// The longest the finale waits for the last answers to show, and how long
// it then holds the finished ledger.
const FINALE_WAIT_MS = 3000;
const FINALE_HOLD_MS = 900;

export function LiveImport({
  progressId,
  readProgress,
  firstStep,
  categorizer,
  finale,
  before,
}: {
  progressId: string;
  /** The server's word on the import; throws a 404 while it has none. */
  readProgress: (progressId: string) => Promise<ImportProgressReport>;
  /** What the import does before the rules: "Set up the account". */
  firstStep: string;
  categorizer: LlmStatus;
  /** Set to this view's finale while it shows. */
  finale: MutableRefObject<Finale | null>;
  /** Shown over the steps until the rows are read. */
  before?: ReactNode;
}) {
  const queryKey = ["import-progress", progressId];
  const progress = useQuery({
    queryKey,
    // Before the import starts and after it answers there is nothing to
    // report: the view shows its first step, or what it last heard.
    queryFn: async ({ client }): Promise<ImportProgressReport | null> => {
      try {
        return await readProgress(progressId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return (
            client.getQueryData<ImportProgressReport | null>(queryKey) ?? null
          );
        }
        throw error;
      }
    },
    refetchInterval: (query) =>
      query.state.data?.stage === "done" ? false : POLL_MS,
    // A long import is watched from another window as often as this one.
    refetchIntervalInBackground: true,
    retry: false,
  });
  const chart = useQuery(chartOfAccountsQuery);
  const seconds = useSeconds();
  const data = progress.data ?? null;
  const steps = importingSteps(data, categorizer, firstStep);
  const rows = data?.rows ?? NO_ROWS;
  const stage = data?.stage ?? "account";

  const [finishing, setFinishing] = useState(false);
  const reveal = useLiveReveal(rows, finishing);
  const hueOf = useMemo(
    () => huesByName(chartAccounts(chart.data)),
    [chart.data],
  );

  // The finale waits for the last answers to show.
  const drainedWaiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (finishing && reveal.drained) {
      for (const done of drainedWaiters.current.splice(0)) done();
    }
  }, [finishing, reveal.drained]);
  const refetch = progress.refetch;
  const shownRows = useRef(false);
  shownRows.current = rows.length > 0;
  useEffect(() => {
    finale.current = async () => {
      await refetch();
      const drained = new Promise<void>((resolve) =>
        drainedWaiters.current.push(resolve),
      );
      setFinishing(true);
      await Promise.race([drained, sleep(FINALE_WAIT_MS)]);
      if (shownRows.current && !prefersStill()) await sleep(FINALE_HOLD_MS);
    };
    return () => {
      finale.current = null;
    };
  }, [finale, refetch]);

  // The agent may still answer the rows that wait.
  const answering =
    categorizer.ready && (stage === "rules" || stage === "llm") && !finishing;

  return (
    <div>
      {rows.length === 0 && before}
      <ol
        aria-label="Progress"
        className={cn(rows.length === 0 && before && "mt-6", "space-y-3.5")}
      >
        {steps.map((step) => (
          <StepRow key={step.label} step={step} />
        ))}
      </ol>
      {rows.length > 0 && (
        <div className="mt-6">
          <LiveLedger
            rows={rows}
            reveal={reveal}
            answering={answering}
            hueOf={hueOf}
          />
        </div>
      )}
      <p role="timer" aria-live="off" className="mt-6 text-meta text-ink-meta">
        <span className="tnum font-mono">{elapsed(seconds)}</span>
        {categorizer.ready && " · This can take a few minutes"}
      </p>
    </div>
  );
}

const NO_ROWS: ImportProgressReport["rows"] = [];

/** The accounts whose hues the ledger shows; none until the chart is read. */
function chartAccounts(chart: ChartOfAccounts | undefined) {
  if (chart === undefined) return [];
  return chart.state === "existing"
    ? chart.chart.accounts
    : chart.starter.accounts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function StepRow({ step }: { step: ImportingStep }) {
  return (
    <li
      aria-current={step.state === "running" ? "step" : undefined}
      className="flex items-start gap-3"
    >
      <Marker state={step.state} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-row",
            step.state === "waiting"
              ? "text-ink-meta"
              : "font-semibold text-foreground",
          )}
        >
          {step.label}
          {step.state === "done" && <span className="sr-only"> (done)</span>}
        </p>
        {step.detail && (
          <p className="tnum text-meta text-ink-soft">{step.detail}</p>
        )}
      </div>
    </li>
  );
}

function Marker({ state }: { state: ImportingStep["state"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
        state === "done" && "bg-primary text-primary-foreground",
        state === "running" && "text-primary",
        state === "waiting" &&
          "border-[1.5px] border-dashed border-waiting-marker",
      )}
    >
      {state === "done" && <Check className="size-3" strokeWidth={3} />}
      {state === "running" && <Loader2 className="size-5 animate-spin" />}
    </span>
  );
}

/** Whole seconds since the view appeared, ticking. */
function useSeconds(): number {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (now - started) / 1000;
}
