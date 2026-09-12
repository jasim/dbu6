import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@sapporta/shared/temporal";
import {
  normalizeChronological,
  type Abacus,
  type AbacusStatement,
} from "./abacus/index.js";
import { parseAccount } from "./domain/Account.js";
import type { DraftImportInput, ImportSummary } from "./draft-import.js";
import {
  BalanceMismatchError,
  StatementPartInvalidError,
} from "./import-errors.js";

// Stub the persistence tail so the test can inspect exactly what reaches it.
// Everything before it (assembly, key assignment, balance validation and the
// reconciliation filter) runs for real.
const draftImportCalls: DraftImportInput[] = [];
vi.mock("./draft-import.js", () => ({
  runDraftImport: async (input: DraftImportInput): Promise<ImportSummary> => {
    draftImportCalls.push(input);
    return {
      hledger_journal: "",
      transaction_count: input.transactions.length,
      skipped_reconciled_count: 0,
      draft_transaction_count: input.transactions.length,
      duplicate_count: 0,
      draft_duplicate_count: 0,
      journal_duplicate_count: 0,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
    };
  },
}));

const { runStatementImport } = await import("./statement-import.js");
type ImportOptions = Parameters<typeof runStatementImport>[1];

const BASE_ACCOUNT = parseAccount("assets:bank:sample");

// A bank part: every row prints its running balance, walked from `opening`.
function bank(
  opening: number,
  spec: Array<[string, number, string]>,
  declared: { opening?: number | null; closing?: number | null } = {},
): AbacusStatement {
  let balance = opening;
  const rows: Abacus[] = spec.map(([date, amount, narration]) => {
    balance += amount;
    return {
      date,
      narration,
      withdrawal: amount < 0 ? -amount : 0,
      deposit: amount > 0 ? amount : 0,
      balance,
    };
  });
  return {
    transactions: normalizeChronological(rows, "ascending"),
    opening: declared.opening ?? null,
    closing: declared.closing ?? null,
    account: null,
    institution: null,
  };
}

function options(): ImportOptions {
  return {
    baseAccount: BASE_ACCOUNT,
    accountKind: "bank",
    customMappingsFilenames: [],
    gpayHtmlPath: null,
  };
}

function stubImportDb(checkpoint?: { date: string; balance: number }): any {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    all: () => [],
    get: () =>
      checkpoint
        ? {
            date: parsePlainDate(checkpoint.date),
            assertion: checkpoint.balance,
          }
        : undefined,
    transaction: (run: (tx: any) => unknown) => run(chain),
  };
  return chain;
}

function keysReachingTail(): string[] {
  return draftImportCalls
    .at(-1)!
    .transactions.map((t) => t.source_transaction_key!);
}

beforeEach(() => {
  draftImportCalls.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runStatementImport over several parts", () => {
  // The first part ends mid-day with one auto-debit; the second part holds
  // the whole day, with a second identical auto-debit after the first.
  const cut = bank(1000, [
    ["2026-06-17", -100, "rent"],
    ["2026-06-18", -50, "auto-debit"],
  ]);
  const full = bank(900, [
    ["2026-06-18", -50, "auto-debit"],
    ["2026-06-18", -50, "auto-debit"],
    ["2026-06-19", 500, "salary"],
  ]);

  it("keys textually identical rows from different parts as distinct occurrences", async () => {
    await runStatementImport(
      [cut, full],
      options(),
      stubImportDb(),
      undefined,
      ["cut", "full"],
    );
    const keys = keysReachingTail();
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
  });

  it("keys before the reconciliation filter, so a mid-day checkpoint does not renumber the day", async () => {
    await runStatementImport(
      [cut, full],
      options(),
      stubImportDb(),
      undefined,
      ["cut", "full"],
    );
    const unfiltered = keysReachingTail();

    // Checkpoint on the first auto-debit (balance 850): the filter trims
    // that row and everything before it, and the second auto-debit must
    // keep the key it had as occurrence 2.
    await runStatementImport(
      [cut, full],
      options(),
      stubImportDb({ date: "2026-06-18", balance: 850 }),
      undefined,
      ["cut", "full"],
    );
    const filtered = keysReachingTail();
    expect(filtered).toEqual(unfiltered.slice(2));
  });

  it("blames a part that fails its own validation by name", async () => {
    const bad = bank(900, [["2026-06-18", -50, "x"]], { closing: 1 });
    await expect(
      runStatementImport([cut, bad], options(), stubImportDb(), undefined, [
        "cut.csv",
        "bad.csv",
      ]),
    ).rejects.toMatchObject({
      name: "StatementPartInvalidError",
      part: "bad.csv",
    });
    await expect(
      runStatementImport([cut, bad], options(), stubImportDb(), undefined, [
        "cut.csv",
        "bad.csv",
      ]),
    ).rejects.toBeInstanceOf(StatementPartInvalidError);
  });

  it("hands the tail the declared edges of the first and last contributing parts", async () => {
    const first = bank(1000, [["2026-06-17", -100, "a"]], {
      opening: 1000,
      closing: 900,
    });
    const middle = bank(900, [["2026-06-18", -50, "b"]], {
      opening: 900,
      closing: 850,
    });
    const last = bank(850, [["2026-06-19", 500, "c"]], {
      opening: 850,
      closing: 1350,
    });
    const result = await runStatementImport(
      [last, first, middle],
      options(),
      stubImportDb(),
    );
    expect(result.balance_metadata.opening).toEqual({
      extracted: 1000,
      effective: 1000,
      source: "statement",
    });
    expect(result.balance_metadata.closing).toEqual({
      extracted: 1350,
      effective: 1350,
      source: "statement",
    });
    expect(
      draftImportCalls.at(-1)!.transactions.map((t) => t.narration),
    ).toEqual(["a", "b", "c"]);
  });

  it("leaves a single part to the closing check rather than part validation", async () => {
    const declaredWrong = bank(1000, [["2026-06-17", -100, "a"]], {
      opening: 1000,
      closing: 500,
    });
    await expect(
      runStatementImport([declaredWrong], options(), stubImportDb()),
    ).rejects.toBeInstanceOf(BalanceMismatchError);
    expect(draftImportCalls).toHaveLength(0);
  });
});
