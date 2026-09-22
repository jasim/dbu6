import type { ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";

export type StatusTone = "ok" | "attention" | "waiting" | "problem";

const TEXT: Record<StatusTone, string> = {
  ok: "text-primary",
  attention: "text-attention-ink",
  waiting: "text-ink-meta",
  problem: "text-destructive",
};

const DOT: Record<StatusTone, string> = {
  ok: "bg-primary",
  attention: "bg-attention",
  waiting: "bg-waiting-marker",
  problem: "bg-destructive",
};

/** The text colour of a tone, for a status line set in words. */
export function statusTextClass(tone: StatusTone): string {
  return TEXT[tone];
}

/**
 * An account's or a file's status: a dot and a word. The word carries the
 * meaning, so the state survives greyscale and colour blindness.
 */
export function StatusChip({
  tone = "ok",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] text-meta font-semibold",
        TEXT[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", DOT[tone])}
      />
      {children}
    </span>
  );
}
