import {
  importProgressIdSchema,
  type ImportProgressReport,
  type ImportProgressRow,
} from "../../shared/index.js";
import {
  amount,
  direction,
  UNCATEGORIZED,
  type Account,
} from "../modules/values/index.js";
import type {
  ImportProgress,
  OnImportProgress,
} from "../workflows/statement-import/index.js";

/*
 * How far a running import has got, for the screen waiting on it (/add's
 * add, /import's batch). An import sent with a `progress_id` is tracked in
 * memory while it runs, and a minute after it answers, at stage `done`, for
 * the screen's last look to find the answers its polling missed.
 */

// How long a finished import's progress stays readable.
const DONE_KEPT_MS = 60_000;

/** The imports running under a route, by their progress ids. */
export interface ProgressBoard {
  /**
   * Starts tracking the import sent with this `progress_id` field (null
   * when it sent none, or one that doesn't parse), and says how to tell it.
   */
  start(progressId: unknown): RunningImport | null;
  read(progressId: string): ImportProgressReport | undefined;
}

export interface RunningImport {
  onProgress: OnImportProgress;
  /** It answered, whichever way: kept a while at `done`. */
  finish(): void;
}

export function progressBoard(): ProgressBoard {
  const running = new Map<string, TrackedProgress>();
  return {
    start(progressId) {
      const parsed = importProgressIdSchema.safeParse(progressId);
      if (!parsed.success) return null;
      const id = parsed.data;
      running.set(id, STARTED);
      return {
        onProgress: (event) =>
          running.set(id, nextProgress(running.get(id), event)),
        finish() {
          const tracked = running.get(id);
          if (tracked === undefined) return;
          const done: TrackedProgress = {
            ...tracked,
            report: { ...tracked.report, stage: "done" },
          };
          running.set(id, done);
          // Unless another import has taken the id since.
          setTimeout(() => {
            if (running.get(id) === done) running.delete(id);
          }, DONE_KEPT_MS).unref();
        },
      };
    },
    read: (progressId) => running.get(progressId)?.report,
  };
}

/** The 404 a progress query answers when nothing runs under its id. */
export const NOT_RUNNING = {
  status: 404 as const,
  body: { error: "No import is running under that id." },
};

/**
 * A running import's progress as reported, and where the rows of the
 * account being categorized start, which its answers count from.
 */
export interface TrackedProgress {
  report: ImportProgressReport;
  groupStart: number;
}

const STARTED: TrackedProgress = {
  report: { stage: "account", rows: [] },
  groupStart: 0,
};

/**
 * Pure: a running import's progress, with its latest word on it. Each
 * account's categorization starts with the rules, whose rows follow those
 * of the accounts before it; its answers name rows by their place in it.
 */
export function nextProgress(
  tracked: TrackedProgress = STARTED,
  event: ImportProgress,
): TrackedProgress {
  const { report } = tracked;
  switch (event.stage) {
    case "rules": {
      const groupStart = report.rows.length;
      const rows = [
        ...report.rows,
        ...event.transactions.map((transaction): ImportProgressRow => ({
          date: transaction.date,
          narration: transaction.narration,
          amount: amount(transaction),
          direction: direction(transaction) === "deposit" ? "in" : "out",
          account: null,
          by: null,
        })),
      ];
      return {
        report: {
          stage: "rules",
          rows: answered(rows, groupStart, event.answers, "rule"),
        },
        groupStart,
      };
    }
    case "llm":
      return {
        ...tracked,
        report: {
          stage: "llm",
          rows: answered(report.rows, tracked.groupStart, event.answers, "llm"),
        },
      };
    case "saving":
      return { ...tracked, report: { ...report, stage: "saving" } };
  }
}

// The rows with an account's answers on them; an UNCATEGORIZED answer
// leaves its row for review.
function answered(
  rows: readonly ImportProgressRow[],
  groupStart: number,
  answers: ReadonlyMap<number, Account>,
  by: "rule" | "llm",
): ImportProgressRow[] {
  const next = [...rows];
  for (const [index, account] of answers) {
    const at = groupStart + index;
    if (account === UNCATEGORIZED || next[at] === undefined) continue;
    next[at] = { ...next[at], account, by };
  }
  return next;
}
