import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@sapporta/ui/cn";
import type { ImportProgressRow } from "../../shared/index";
import { accountHueColor, type AccountHueKey } from "../components/account-hue";
import { formatAmount } from "../components/amount";
import { formatShortDate, plural } from "../format";
import {
  nextReveal,
  revealPace,
  ruleRows,
  tally,
  unrevealed,
  waitingGroups,
  type Revealed,
} from "./live-ledger";

/*
 * The importing screen's ledger (live-ledger.ts says how it paces itself):
 * a bar of the accounts shown so far over the import's rows, each row's
 * account landing as it is answered.
 */

/** Whether the screen wants no motion: then every answer shows at once. */
export function prefersStill(): boolean {
  return (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface LiveReveal {
  revealed: Revealed;
  /** The rows the last of the agent's answers showed, to follow. */
  latest: readonly number[];
  /** Every answered row is shown. */
  drained: boolean;
}

/**
 * The rows shown so far: the rules' at once, a frame after the rows appear
 * so they sweep in; the agent's a narration at a time, faster once
 * `finishing`.
 */
export function useLiveReveal(
  rows: readonly ImportProgressRow[],
  finishing: boolean,
): LiveReveal {
  const [still] = useState(prefersStill);
  const [revealed, setRevealed] = useState<Revealed>(() => new Set());
  const [latest, setLatest] = useState<readonly number[]>([]);

  const show = (indices: readonly number[]) =>
    setRevealed((before) => new Set([...before, ...indices]));

  useEffect(() => {
    if (still) {
      if (unrevealed(rows, revealed).length > 0) {
        show(unrevealed(rows, revealed));
      }
      return;
    }
    const rules = ruleRows(rows).filter((index) => !revealed.has(index));
    if (rules.length > 0) {
      const frame = requestAnimationFrame(() => show(rules));
      return () => cancelAnimationFrame(frame);
    }
    const groups = waitingGroups(rows, revealed);
    if (groups === 0) return;
    const timer = setTimeout(
      () => {
        const next = nextReveal(rows, revealed);
        show(next);
        setLatest(next);
      },
      revealPace(groups, finishing),
    );
    return () => clearTimeout(timer);
  }, [rows, revealed, finishing, still]);

  return {
    revealed,
    latest,
    drained: unrevealed(rows, revealed).length === 0,
  };
}

// How long after the user scrolls the list it stops following the answers.
const HANDS_OFF_MS = 4000;

export function LiveLedger({
  rows,
  reveal,
  answering,
  hueOf,
}: {
  rows: readonly ImportProgressRow[];
  reveal: LiveReveal;
  /** Someone may still answer the rows that wait: the bar shows it. */
  answering: boolean;
  hueOf: (name: string) => AccountHueKey;
}) {
  const { revealed, latest } = reveal;
  const scroller = useRef<HTMLDivElement>(null);
  const touched = useRef(0);
  const counts = tally(rows, revealed, hueOf);
  const shown = counts.total - counts.waiting;

  // Follow the answers down the list, unless the user is reading it.
  useEffect(() => {
    const list = scroller.current;
    if (list === null || latest.length === 0) return;
    if (Date.now() - touched.current < HANDS_OFF_MS) return;
    const row = list.querySelector<HTMLElement>(`[data-row="${latest[0]}"]`);
    if (row === null) return;
    list.scrollTo({
      top: Math.max(0, row.offsetTop - list.clientHeight / 3),
      behavior: prefersStill() ? "auto" : "smooth",
    });
  }, [latest]);

  const handsOn = () => {
    touched.current = Date.now();
  };

  return (
    <div>
      <div
        aria-hidden="true"
        className="flex h-2.5 gap-px overflow-hidden rounded-full bg-card"
      >
        {counts.segments.map((segment) => (
          <span
            key={segment.account}
            title={`${segment.account}: ${segment.count}`}
            className="ledger-seg"
            style={
              {
                "--seg": segment.count,
                background: accountHueColor(segment.hue),
              } as CSSProperties
            }
          />
        ))}
        {counts.waiting > 0 && (
          <span
            className={cn(
              "ledger-seg",
              answering ? "ledger-wait" : "bg-tile-bg",
            )}
            style={{ "--seg": counts.waiting } as CSSProperties}
          />
        )}
      </div>
      <p aria-live="polite" className="tnum mt-2 text-meta text-ink-soft">
        {shown} of {plural(counts.total, "transaction")} categorized
      </p>
      <div
        ref={scroller}
        onWheel={handsOn}
        onTouchMove={handsOn}
        onKeyDown={handsOn}
        className="relative mt-3 max-h-[min(48vh,360px)] overflow-y-auto rounded-lg border border-sap-border"
      >
        <ol aria-label="Transactions">
          {rows.map((row, index) => (
            <LedgerRow
              key={index}
              index={index}
              row={row}
              shown={revealed.has(index)}
              hueOf={hueOf}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

// Rows past this many slide in together, below the fold.
const STAGGERED_ROWS = 24;

function LedgerRow({
  index,
  row,
  shown,
  hueOf,
}: {
  index: number;
  row: ImportProgressRow;
  shown: boolean;
  hueOf: (name: string) => AccountHueKey;
}) {
  const account = shown ? row.account : null;
  const hue = account === null ? null : hueOf(account);
  return (
    <li
      data-row={index}
      className={cn(
        "ledger-row-in grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-line-inner px-3 py-[7px] first:border-t-0 sm:grid-cols-[48px_minmax(0,1fr)_auto_96px]",
        account !== null && row.by === "llm" && "ledger-flash",
      )}
      style={
        {
          "--ledger-i": Math.min(index, STAGGERED_ROWS),
          "--ledger-hue": hue === null ? undefined : accountHueColor(hue),
        } as CSSProperties
      }
    >
      <span className="tnum font-mono text-[12px] text-ink-meta max-sm:hidden">
        {formatShortDate(row.date)}
      </span>
      <span
        title={row.narration}
        className="truncate font-mono text-[12px] text-foreground"
      >
        {row.narration}
      </span>
      <span className="flex justify-end">
        {account !== null && hue !== null ? (
          <span
            data-by={row.by}
            title={account}
            className="ledger-chip-in inline-flex max-w-[112px] items-center gap-1.5 text-[12.5px] text-foreground sm:max-w-[150px]"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: accountHueColor(hue) }}
            />
            <span className="truncate">{account}</span>
          </span>
        ) : (
          // Answered, and about to show. A row no one has answered is
          // blank: the bar says whether the agent is still at work.
          row.account !== null && (
            <span
              aria-label="Waiting for an account"
              className="ledger-wait block h-4 w-20 rounded-full"
            />
          )
        )}
      </span>
      <span
        className={cn(
          "tnum text-right font-mono text-[12px] max-sm:hidden",
          row.direction === "in" ? "text-money-in" : "text-foreground",
        )}
      >
        {formatAmount(row.amount, row.direction)}
      </span>
    </li>
  );
}
