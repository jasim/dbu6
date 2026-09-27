import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { ApiError } from "@sapporta/shared/client";
import { cn } from "@sapporta/ui/cn";
import type { AddProgress, LlmStatus } from "../../shared/index";
import { addAccountApi } from "../api";
import { FactTable, type Fact } from "../components/fact-table";
import { FocusCard, type FocusFrame } from "../components/focus-card";
import { elapsed, importingSteps, type ImportingStep } from "./importing-steps";

/** A fresh name for one add, which its progress is asked by. */
export function newProgressId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `add-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Often enough that each of the agent's answers shows as it lands.
const POLL_MS = 700;

/**
 * Card 4's add, while it runs: the account it writes, what it is importing,
 * and each step as the server reports it, with the time it has taken.
 */
export function Importing({
  frame,
  progressId,
  name,
  facts,
  categorizer,
}: {
  frame: FocusFrame;
  progressId: string;
  name: string;
  /** The account and statements, as Confirm had them. */
  facts: readonly Fact[];
  categorizer: LlmStatus;
}) {
  const queryKey = ["add-account", "progress", progressId];
  const progress = useQuery({
    queryKey,
    // Before the add starts and after it answers there is nothing to
    // report: the card shows its first step, or what it last heard.
    queryFn: async ({ client }): Promise<AddProgress | null> => {
      try {
        return await addAccountApi.addProgress({
          params: { progressId },
          query: {},
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return client.getQueryData<AddProgress | null>(queryKey) ?? null;
        }
        throw error;
      }
    },
    refetchInterval: POLL_MS,
    retry: false,
  });
  const seconds = useSeconds();
  const steps = importingSteps(progress.data ?? null, categorizer);

  return (
    <FocusCard {...frame} title={name === "" ? "Adding" : `Adding ${name}`}>
      <FactTable rows={facts} />
      <ol aria-label="Progress" className="mt-6 space-y-3.5">
        {steps.map((step) => (
          <StepRow key={step.label} step={step} />
        ))}
      </ol>
      <p role="timer" aria-live="off" className="mt-6 text-meta text-ink-meta">
        <span className="tnum font-mono">{elapsed(seconds)}</span>
        {categorizer.ready && " · This can take a few minutes"}
      </p>
    </FocusCard>
  );
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

/** Whole seconds since the card appeared, ticking. */
function useSeconds(): number {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (now - started) / 1000;
}
