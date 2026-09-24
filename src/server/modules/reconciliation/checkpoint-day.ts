import type { PostedRow, ReconciledCheckpoint } from "../journals/index.js";
import type { Abacus } from "../statement/index.js";
import {
  type Chrono,
  normalizeIdentityText,
  sameAmount,
  unsafeAsChrono,
} from "../values/index.js";

/*
 * Which of the statement's rows on the checkpoint's date are new: those left
 * once each row the books hold that day is paired with its statement row.
 * checkpoint-day.md records the decision.
 */

/**
 * The statement's rows on the checkpoint's date (`onDate`) that the books
 * don't hold yet, or null when the pairing can't vouch for the day and the
 * balance anchor decides instead:
 * - the day's first row prints no balance;
 * - the statement starts on the day and a journal that day has no key;
 * - the statement holds the whole day (`holdsWholeDay`), yet a row in the
 *   books has no statement row, or two could be its row and differ;
 * - the day's opening, plus the rows the checkpoint counted, doesn't reach
 *   the checkpoint's balance.
 */
export function newOnCheckpointDay(
  onDate: Chrono<Abacus>,
  checkpoint: ReconciledCheckpoint,
  posted: readonly PostedRow[],
  holdsWholeDay: boolean,
): Chrono<Abacus> | null {
  const first = onDate[0];
  if (first.balance === null) return null;
  if (!holdsWholeDay && posted.some((row) => row.origin === "unkeyed")) {
    return null;
  }

  const paired = holdsWholeDay
    ? pairWholeDay(onDate, posted)
    : pairByKey(onDate, posted).paired;
  if (paired === null) return null;

  let reached = first.balance - first.deposit + first.withdrawal;
  for (const [index, row] of paired) {
    if (row.counted) reached += signed(onDate[index]);
  }
  if (!sameAmount(reached, checkpoint.balance)) return null;

  // A filter keeps the statement's order.
  return unsafeAsChrono(onDate.filter((_, i) => !paired.has(i)));
}

// Statement row index → the row in the books it is.
type Pairing = Map<number, PostedRow>;

// Pairs each row in the books with the statement row that has its key. A
// statement that starts partway through the day may not hold the rest; they
// sit before it.
function pairByKey(
  onDate: Chrono<Abacus>,
  posted: readonly PostedRow[],
): { paired: Pairing; unpaired: PostedRow[] } {
  const paired: Pairing = new Map();
  const unpaired: PostedRow[] = [];
  for (const row of posted) {
    const index =
      row.key === null
        ? -1
        : onDate.findIndex(
            (t, i) => !paired.has(i) && t.source_transaction_key === row.key,
          );
    if (index >= 0) paired.set(index, row);
    else unpaired.push(row);
  }
  return { paired, unpaired };
}

// Pairs every row in the books with a statement row, which holds the whole
// day: by key, then by amount and wording, then by amount alone. Null when a
// row in the books is left without one.
function pairWholeDay(
  onDate: Chrono<Abacus>,
  posted: readonly PostedRow[],
): Pairing | null {
  const { paired, unpaired } = pairByKey(onDate, posted);
  const free = (row: PostedRow) =>
    onDate.flatMap((t, i) =>
      !paired.has(i) && sameAmount(signed(t), row.amount) ? [i] : [],
    );

  const unworded: PostedRow[] = [];
  for (const row of unpaired) {
    const worded = free(row).find(
      (i) => wording(onDate[i].narration) === wording(row.narration),
    );
    if (worded === undefined) unworded.push(row);
    else paired.set(worded, row);
  }

  for (const row of unworded) {
    const candidates = free(row);
    if (candidates.length === 0) return null;
    // Rows that move the same amount and read alike are the same row as far
    // as the books can tell; rows that read differently can't be told apart.
    const readings = new Set(
      candidates.map((i) => wording(onDate[i].narration)),
    );
    if (readings.size > 1) return null;
    paired.set(candidates[0], row);
  }
  return paired;
}

function signed(t: Abacus): number {
  return t.deposit - t.withdrawal;
}

function wording(narration: string): string {
  return normalizeIdentityText(narration);
}
