// Combining several AbacusStatements (one per uploaded file) into the single
// statement the balance-validation tail consumes.
import type { StatementAccount } from "dbu6-shared";
import type { Chrono } from "../domain/Chrono.js";
import {
  OverlappingStatementsError,
  StatementBoundaryMismatchError,
} from "../import-errors.js";
import type { Abacus, AbacusStatement } from "./Abacus.js";
import { normalizeChronological } from "./balances.js";

type OrderedStatementPart = {
  part: AbacusStatement;
  sourceName: string;
  minDate: string;
  maxDate: string;
  inputPart: number;
  transactionCount: number;
};

function orderedStatementParts(
  parts: AbacusStatement[],
  sourceNames: readonly string[],
): OrderedStatementPart[] {
  const nonEmpty = parts
    .map((part, inputIndex) => ({ part, inputIndex }))
    .filter(({ part }) => part.transactions.length > 0)
    .map(({ part, inputIndex }) => {
      const dates = part.transactions.map((t) => t.date);
      return {
        part,
        inputPart: inputIndex + 1,
        sourceName: sourceNames[inputIndex] ?? `part #${inputIndex + 1}`,
        transactionCount: part.transactions.length,
        minDate: dates.reduce((a, b) => (a < b ? a : b)),
        maxDate: dates.reduce((a, b) => (a > b ? a : b)),
      };
    })
    .sort((a, b) => a.minDate.localeCompare(b.minDate));

  for (let i = 1; i < nonEmpty.length; i++) {
    if (nonEmpty[i].minDate <= nonEmpty[i - 1].maxDate) {
      console.error(
        `[freeform-import] overlapping statement parts detected:\n${JSON.stringify(
          {
            overlapCheck: {
              expression: "currentPart.minDate <= previousPart.maxDate",
              currentMinDate: nonEmpty[i].minDate,
              previousMaxDate: nonEmpty[i - 1].maxDate,
              result: true,
            },
            previousPart: nonEmpty[i - 1],
            currentPart: nonEmpty[i],
          },
          null,
          2,
        )}`,
      );
      throw new OverlappingStatementsError(
        nonEmpty[i - 1].maxDate,
        nonEmpty[i].minDate,
      );
    }
  }
  return nonEmpty;
}

// Adjacent statements must agree where they meet: the earlier one's closing
// is the later one's opening, when both are printed.
export function validateStatementBoundaries(
  parts: AbacusStatement[],
  sourceNames: readonly string[] = [],
): void {
  const ordered = orderedStatementParts(parts, sourceNames);
  for (let i = 1; i < ordered.length; i++) {
    const earlier = ordered[i - 1];
    const later = ordered[i];
    if (earlier.part.closing === null || later.part.opening === null) continue;
    if (Math.abs(earlier.part.closing - later.part.opening) > 0.005) {
      throw new StatementBoundaryMismatchError(
        earlier.part.closing,
        later.part.opening,
        earlier.sourceName,
        later.sourceName,
      );
    }
  }
}

// Merge the per-file statements into a single AbacusStatement that the
// balance-validation tail can consume as if it had come from one file.
// Files are ordered by the earliest transaction date they contain —
// regardless of each file's internal ascending/descending order — so
// concatenating the per-file transaction arrays yields a run that roughly
// traces the period from start to end. (`computeRunningBalances` re-sorts
// by date anyway; this ordering only matters for human-readable logs and
// for choosing which file contributes the opening/closing of the merged
// period.) The merged opening comes from the chronologically-earliest
// file and the merged closing from the latest; intermediate files'
// opening/closing values are dropped because they describe internal
// checkpoints of a now-stitched-together period. Source names stay aligned
// with input positions and are used only when logging an overlap.
export function mergeStatements(
  parts: AbacusStatement[],
  sourceNames: readonly string[] = [],
): AbacusStatement {
  if (parts.length === 1) return parts[0];

  const nonEmpty = orderedStatementParts(parts, sourceNames);

  const ordered = nonEmpty.map((x) => x.part);
  const concatenated: Abacus[] = ordered.flatMap((p) => [...p.transactions]);
  const transactions: Chrono<Abacus> = normalizeChronological(
    concatenated,
    "ascending",
  );
  return {
    transactions,
    opening: ordered[0]?.opening ?? null,
    closing: ordered[ordered.length - 1]?.closing ?? null,
    account: sharedValue(parts, (part) => part.account, sameAccount),
    institution: sharedValue(
      parts,
      (part) => part.institution,
      (a, b) => a === b,
    ),
  };
}

function sameAccount(a: StatementAccount, b: StatementAccount): boolean {
  return a.kind === b.kind && a.identifier === b.identifier;
}

// The merged statement describes one account (or institution) only when
// every part that names one names the same one. Parts that disagree yield
// null here; the upload route compares each part against the selected preset
// before this merge, which is where a mix-up is reported.
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
