// Assembling the per-file statements of one upload into the single statement
// the balance-validation tail consumes.
//
// The whole algorithm:
//
// Each part is placed on the balance line by two numbers, its start (the
// balance before its first row) and its end (the balance after its last
// row). One anchor is enough to derive both: a declared opening, a declared
// closing, or any printed row balance. A part with no anchor can only be
// imported alone. A part that has two or more anchors must agree with itself
// before it is used at all.
//
// Parts are then sorted by date and folded one at a time into a growing run.
// Joining a part to the run takes three steps:
//
//   1. Shared days. Only when both sides print a balance on every row. Any
//      day both cover must read the same in both, row for row; on the day
//      that ends either side, the shorter reading may be a prefix of the
//      longer (an export cut mid-day), or they may share no rows at all (a
//      day split between two exports). The run's copy is kept and the part's
//      dropped. Anything else means the two disagree about that day, and no
//      join order can repair it, so it is refused at once.
//   2. Forward chain. What is left of the part follows the run when the run's
//      end equals the part's start, exactly.
//   3. Reverse chain. Otherwise the part precedes the run when the part's end
//      equals the run's start. This is a fallback, never a competitor: both
//      directions hold whenever the part's net is minus the run's, which is
//      ordinary for consecutive statements, so treating them as rivals would
//      refuse valid uploads.
//
// A part that chains neither way is not refused yet. The date sort is only a
// preference: a card row posted late puts its cycle before the one it
// follows. The part goes to the back of the queue and is retried after the
// others; only when a full pass joins nothing is the head refused, as a
// duplicate statement, a disagreement about a shared day, or a gap with the
// exact missing amount.
//
// Why this works without any alignment search: exports are pulled by date
// range and card cycles are fixed, so parts only ever touch at day
// boundaries. Cards never print row balances, so their shared dates are
// never compared and a late-posted row is left alone by construction.
//
// Known limits: a gap whose missing activity nets to zero chains cleanly and
// is not detected; two parsers wording one shared day differently are
// refused rather than reconciled; a part whose overlap begins partway
// through another part's day is refused as a disagreement.
//
// Everything here is pure over `AbacusStatement` plus the parts' names.
import type { StatementAccount } from "dbu6-shared";
import {
  ApiImportError,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
  type DisagreeingRow,
} from "./import-errors.js";
import {
  normalizeIdentityText,
  transactionAmountMinor,
  direction,
} from "../values/index.js";
import type { Abacus, AbacusStatement } from "./Abacus.js";
import {
  BALANCE_TOLERANCE,
  normalizeChronological,
  synthesizeRunningBalances,
  verifyClosingBalance,
} from "./balances.js";

// Two balances that should be the same number are allowed to differ by less
// than half a paisa: printed values are exact, so this only absorbs float
// arithmetic over a part's net.
export const ANCHOR_EPSILON = 0.005;

const LOG = "[statement-assembly]";

// The edges come from the rows whenever any row prints a balance, and from
// the declared values only otherwise: a declared value is only checked
// against the rows at `BALANCE_TOLERANCE` (a whole rupee), while the join
// needs the exact figure.
export type PartEdges = {
  // Balance before the first row and after the last row; both null when the
  // part has no anchor at all.
  start: number | null;
  end: number | null;
  // Every row prints its running balance. Only then can a shared day be
  // compared row by row, since each printed balance pins the row's place.
  printsEveryRow: boolean;
};

export function partEdges(part: AbacusStatement): PartEdges {
  const rows = part.transactions;
  const printsEveryRow =
    rows.length > 0 && rows.every((row) => row.balance !== null);
  if (rows.some((row) => row.balance !== null)) {
    const filled = synthesizeRunningBalances(rows, null);
    return {
      start: balanceBefore(filled[0]),
      end: filled[filled.length - 1].balance,
      printsEveryRow,
    };
  }
  const total = net(rows);
  if (part.opening !== null) {
    return { start: part.opening, end: part.opening + total, printsEveryRow };
  }
  if (part.closing !== null) {
    return { start: part.closing - total, end: part.closing, printsEveryRow };
  }
  return { start: null, end: null, printsEveryRow };
}

// Printed balances must chain, and the declared opening and closing must
// match the balance before the first row and after the last, all at the
// existing `BALANCE_TOLERANCE` so nothing a single-file import accepts is
// refused here.
export function validatePart(part: AbacusStatement, name: string): void {
  const rows = part.transactions;
  const anyPrinted = rows.some((row) => row.balance !== null);
  if (!anyPrinted && (part.opening === null || part.closing === null)) return;
  try {
    const filled = synthesizeRunningBalances(
      rows,
      anyPrinted ? null : part.opening,
    );
    verifyClosingBalance(filled, part.closing);
    if (anyPrinted && part.opening !== null && filled.length > 0) {
      const start = balanceBefore(filled[0]);
      if (Math.abs(start - part.opening) > BALANCE_TOLERANCE) {
        throw new StatementPartInvalidError(
          name,
          `its declared opening ${part.opening} does not match the balance before its first row (${start}); tolerance ${BALANCE_TOLERANCE}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof StatementPartInvalidError) throw err;
    if (err instanceof ApiImportError) {
      throw new StatementPartInvalidError(name, err.message, err);
    }
    throw err;
  }
}

type Part = {
  name: string;
  statement: AbacusStatement;
  edges: { start: number; end: number };
  printsEveryRow: boolean;
  firstDate: string;
  lastDate: string;
};

// A row inside the run remembers the part it came from, so a refusal can
// name the part that actually holds the disputed day.
type RunRow = { row: Abacus; part: string };

// The accumulated run: rows in succession order (not yet date-sorted), the
// balances at its two ends, and the parts that supplied its first and last
// rows, whose declared opening and closing the tail consumes.
type Run = {
  rows: RunRow[];
  start: number;
  end: number;
  printsEveryRow: boolean;
  first: Part;
  last: Part;
};

// The rows of a part that the run does not already hold, with the edges
// recomputed over what remains.
type Remainder = {
  rows: readonly Abacus[];
  start: number;
  end: number;
  dropped: Array<{ date: string; count: number }>;
};

export function assembleStatements(
  parts: AbacusStatement[],
  sourceNames: readonly string[] = [],
): AbacusStatement {
  if (parts.length === 1) return parts[0];

  const named = parts
    .map((statement, index) => ({
      statement,
      name: sourceNames[index] ?? `part #${index + 1}`,
    }))
    .filter(({ statement }) => statement.transactions.length > 0);
  if (named.length === 1) return named[0].statement;
  if (named.length === 0) {
    return {
      transactions: normalizeChronological([], "ascending"),
      opening: null,
      closing: null,
      account: sharedValue(parts, (part) => part.account, sameAccount),
      institution: sharedValue(
        parts,
        (part) => part.institution,
        (a, b) => a === b,
      ),
    };
  }

  const anchored = named.map(({ statement, name }): Part => {
    validatePart(statement, name);
    const edges = partEdges(statement);
    if (edges.start === null || edges.end === null) {
      throw new StatementPartUnjoinableError(name);
    }
    const dates = statement.transactions.map((row) => row.date);
    return {
      name,
      statement,
      edges: { start: edges.start, end: edges.end },
      printsEveryRow: edges.printsEveryRow,
      firstDate: dates.reduce((a, b) => (a < b ? a : b)),
      lastDate: dates.reduce((a, b) => (a > b ? a : b)),
    };
  });

  const run = fold(anchored);
  return {
    transactions: normalizeChronological(
      run.rows.map((one) => one.row),
      "ascending",
    ),
    opening: run.first.statement.opening,
    closing: run.last.statement.closing,
    account: sharedValue(parts, (part) => part.account, sameAccount),
    institution: sharedValue(
      parts,
      (part) => part.institution,
      (a, b) => a === b,
    ),
  };
}

// Each part is joined against the whole run, not the previous part, which
// is what catches a part contained in the first that still overlaps a third.
function fold(parts: Part[]): Run {
  const ordered = [...parts].sort(
    (a, b) =>
      a.firstDate.localeCompare(b.firstDate) ||
      a.lastDate.localeCompare(b.lastDate),
  );
  const [seed, ...rest] = ordered;
  let run: Run = {
    rows: seed.statement.transactions.map((row) => ({ row, part: seed.name })),
    start: seed.edges.start,
    end: seed.edges.end,
    printsEveryRow: seed.printsEveryRow,
    first: seed,
    last: seed,
  };

  const queue = rest;
  let deferred = 0;
  while (queue.length > 0) {
    const part = queue.shift()!;
    const remainder = dropSharedDays(run, part);
    const joined = chain(run, part, remainder);
    if (joined === null) {
      queue.push(part);
      deferred++;
      if (deferred === queue.length) {
        const head = queue[0];
        refuse(run, head, dropSharedDays(run, head));
      }
      continue;
    }
    run = joined;
    deferred = 0;
  }
  return run;
}

// Step 1: shared days.
function dropSharedDays(run: Run, part: Part): Remainder {
  const rows = part.statement.transactions;
  if (!(run.printsEveryRow && part.printsEveryRow)) {
    return { rows, start: part.edges.start, end: part.edges.end, dropped: [] };
  }

  const runDays = groupByDate(run.rows);
  const runLastDate = [...runDays.keys()].reduce((a, b) => (a > b ? a : b));
  const kept: Abacus[] = [];
  const dropped: Remainder["dropped"] = [];
  for (const [date, theirs] of groupByDate(rows.map((row) => ({ row })))) {
    const ours = runDays.get(date);
    if (ours === undefined) {
      kept.push(...theirs.map((one) => one.row));
      continue;
    }
    const shared = commonPrefix(ours, theirs);
    const edgeDay = date === runLastDate || date === part.lastDate;
    if (edgeDay && shared === 0) {
      kept.push(...theirs.map((one) => one.row));
      continue;
    }
    const agree = edgeDay
      ? shared === Math.min(ours.length, theirs.length)
      : shared === ours.length && shared === theirs.length;
    if (!agree) {
      const differing =
        shared < theirs.length
          ? disagreeingRow(theirs[shared].row, part.name)
          : disagreeingRow(ours[shared].row, ours[shared].part);
      throw new StatementDisagreementError(
        [ours[0].part, part.name],
        date,
        differing,
      );
    }
    kept.push(...theirs.slice(shared).map((one) => one.row));
    dropped.push({ date, count: shared });
  }

  if (kept.length === 0) {
    return { rows: kept, start: part.edges.end, end: part.edges.end, dropped };
  }
  return {
    rows: kept,
    start: balanceBefore(kept[0]),
    end: kept[kept.length - 1].balance!,
    dropped,
  };
}

// Steps 2 and 3: forward chain, then reverse chain as the fallback.
function chain(run: Run, part: Part, remainder: Remainder): Run | null {
  const { rows, start, end, dropped } = remainder;
  const tagged = rows.map((row) => ({ row, part: part.name }));
  if (rows.length === 0) {
    logJoin(run, part, "already contained", dropped);
    return run;
  }
  if (near(run.end, start)) {
    logJoin(run, part, "forward chain", dropped);
    return {
      rows: [...run.rows, ...tagged],
      start: run.start,
      end,
      printsEveryRow: run.printsEveryRow && part.printsEveryRow,
      first: run.first,
      last: part,
    };
  }
  if (near(end, run.start)) {
    logJoin(run, part, "reverse chain", dropped);
    return {
      rows: [...tagged, ...run.rows],
      start,
      end: run.end,
      printsEveryRow: run.printsEveryRow && part.printsEveryRow,
      first: part,
      last: run.last,
    };
  }
  return null;
}

// Why the head of the queue joins nothing, most specific reason first.
function refuse(run: Run, part: Part, remainder: Remainder): never {
  const runDates = new Set(run.rows.map((one) => one.row.date));
  const partDates = new Set(part.statement.transactions.map((row) => row.date));
  const sameDates =
    runDates.size === partDates.size &&
    [...partDates].every((date) => runDates.has(date));
  if (
    sameDates &&
    near(part.edges.start, run.start) &&
    near(part.edges.end, run.end)
  ) {
    throw new StatementBoundaryMismatchError(
      run.end,
      part.edges.start,
      run.last.name,
      part.name,
      "same-statement-twice",
    );
  }

  const disputed = remainder.rows.find((row) => runDates.has(row.date));
  if (disputed !== undefined) {
    const holder = run.rows.find((one) => one.row.date === disputed.date)!;
    throw new StatementDisagreementError(
      [holder.part, part.name],
      disputed.date,
      disagreeingRow(disputed, part.name),
    );
  }

  const runLastDate = [...runDates].reduce((a, b) => (a > b ? a : b));
  if (part.firstDate >= runLastDate) {
    throw new StatementBoundaryMismatchError(
      run.end,
      remainder.start,
      run.last.name,
      part.name,
    );
  }
  throw new StatementBoundaryMismatchError(
    remainder.end,
    run.start,
    part.name,
    run.first.name,
  );
}

function logJoin(
  run: Run,
  part: Part,
  how: string,
  dropped: Remainder["dropped"],
): void {
  const held = run.rows.map((one) => one.part);
  const names = held.filter((name, index) => held.indexOf(name) === index);
  const drops = dropped.filter((one) => one.count > 0);
  const droppedText =
    drops.length === 0
      ? "no rows dropped"
      : `dropped ${drops.map((one) => `${one.count} row(s) on ${one.date}`).join(", ")}`;
  console.log(
    `${LOG} joined ${part.name} to ${names.join(" + ")} (${how}); ${droppedText}`,
  );
}

// Two rows on a shared day are the same when their direction, amount and
// printed balance (all in minor units) and their normalized narration agree.
// Text alone never decides: the printed balance and the position in the day
// must agree too.
function sameRow(a: Abacus, b: Abacus): boolean {
  return (
    direction(a) === direction(b) &&
    transactionAmountMinor(a) === transactionAmountMinor(b) &&
    minor(a.balance) === minor(b.balance) &&
    normalizeIdentityText(a.narration) === normalizeIdentityText(b.narration)
  );
}

function commonPrefix(
  ours: readonly { row: Abacus }[],
  theirs: readonly { row: Abacus }[],
): number {
  let shared = 0;
  while (
    shared < ours.length &&
    shared < theirs.length &&
    sameRow(ours[shared].row, theirs[shared].row)
  ) {
    shared++;
  }
  return shared;
}

function groupByDate<T extends { row: Abacus }>(rows: T[]): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const one of rows) {
    const day = days.get(one.row.date);
    if (day === undefined) days.set(one.row.date, [one]);
    else day.push(one);
  }
  return days;
}

function disagreeingRow(row: Abacus, part: string): DisagreeingRow {
  return {
    part,
    narration: row.narration,
    withdrawal: row.withdrawal,
    deposit: row.deposit,
    balance: row.balance,
  };
}

function minor(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < ANCHOR_EPSILON;
}

function net(rows: readonly Abacus[]): number {
  return rows.reduce((sum, row) => sum + row.deposit - row.withdrawal, 0);
}

// The balance before a row whose running balance is filled in.
function balanceBefore(row: Abacus): number {
  return row.balance! - row.deposit + row.withdrawal;
}

function sameAccount(a: StatementAccount, b: StatementAccount): boolean {
  return a.kind === b.kind && a.identifier === b.identifier;
}

// The assembled statement describes one account (or institution) only when
// every part that names one names the same one. Parts that disagree yield
// null here; the upload route compares each part against the selected preset
// before assembly, which is where a mix-up is reported.
function sharedValue<T>(
  parts: AbacusStatement[],
  pick: (part: AbacusStatement) => T | null,
  same: (a: T, b: T) => boolean,
): T | null {
  const named = parts.flatMap((part) => {
    const value = pick(part);
    return value === null ? [] : [value];
  });
  if (named.length === 0) return null;
  const [first] = named;
  return named.every((value) => same(value, first)) ? first : null;
}
