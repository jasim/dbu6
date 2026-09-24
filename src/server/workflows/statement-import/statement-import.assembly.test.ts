import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@sapporta/shared/temporal";
import {
  normalizeChronological,
  type Abacus,
  type AbacusStatement,
  BalanceMismatchError,
  StatementPartInvalidError,
} from "../../modules/statement/index.js";
import type { Categorizer } from "../../modules/categorization/index.js";
import { parseAccount, moneyFromColumns } from "../../modules/values/index.js";
import type { DraftImportInput, ImportSummary } from "./draft-import.js";
import { runStatementImport, type ImportOptions } from "./statement-import.js";
import { testImportLedger } from "./test-ledger.js";
import { assignSourceTransactionKeys } from "../../modules/transaction-identity/index.js";

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
      categorization: {
        agent: null,
        sent_count: 0,
        failed_count: 0,
        error: null,
        failure: null,
      },
      categorization_tally: {
        by_rule: 0,
        by_llm: 0,
        same_account: 0,
        uncategorized: 0,
        accounts: [],
      },
      base_account_id: input.baseAccountId,
    };
  },
}));

const BASE_ACCOUNT = parseAccount("Sample Bank");

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
      ...moneyFromColumns({
        withdrawal: amount < 0 ? -amount : 0,
        deposit: amount > 0 ? amount : 0,
      }),
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

// Categorization would read the user's config and run the coding agent's CLI;
// these tests import with no config and an engine that can't call anything.
const noConfig = { ok: false, error: new Error("no config in tests") } as const;
const noCategorizer: Categorizer = {
  classify: noConfig,
  customMappings: noConfig,
  llm: {
    agent: null,
    name: "no engine in tests",
    caller: { ready: false, reason: "no engine in tests" },
  },
};

function options(): ImportOptions {
  return {
    baseAccount: BASE_ACCOUNT,
    accountKind: "bank",
    categorizer: noCategorizer,
    gpay: null,
  };
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
      testImportLedger(BASE_ACCOUNT),
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
      testImportLedger(BASE_ACCOUNT),
      ["cut", "full"],
    );
    const unfiltered = keysReachingTail();

    // Checkpoint on the first auto-debit (balance 850): the filter trims
    // that row and everything before it, and the second auto-debit must
    // keep the key it had as occurrence 2.
    await runStatementImport(
      [cut, full],
      options(),
      testImportLedger(BASE_ACCOUNT, { date: "2026-06-18", balance: 850 }),
      ["cut", "full"],
    );
    const filtered = keysReachingTail();
    expect(filtered).toEqual(unfiltered.slice(2));
  });

  it("blames a part that fails its own validation by name", async () => {
    const bad = bank(900, [["2026-06-18", -50, "x"]], { closing: 1 });
    await expect(
      runStatementImport(
        [cut, bad],
        options(),
        testImportLedger(BASE_ACCOUNT),
        ["cut.csv", "bad.csv"],
      ),
    ).rejects.toMatchObject({
      name: "StatementPartInvalidError",
      part: "bad.csv",
    });
    await expect(
      runStatementImport(
        [cut, bad],
        options(),
        testImportLedger(BASE_ACCOUNT),
        ["cut.csv", "bad.csv"],
      ),
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
      testImportLedger(BASE_ACCOUNT),
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
      runStatementImport(
        [declaredWrong],
        options(),
        testImportLedger(BASE_ACCOUNT),
      ),
    ).rejects.toBeInstanceOf(BalanceMismatchError);
    expect(draftImportCalls).toHaveLength(0);
  });
});

describe("runStatementImport on the checkpoint day", () => {
  // The books were cut after the morning row, at 850. Salary and a transfer
  // of the same amount then bring the balance back to 850.
  const statement = bank(1000, [
    ["2026-06-17", -100, "rent"],
    ["2026-06-18", -50, "sample morning"],
    ["2026-06-18", 500, "NOPII salary"],
    ["2026-06-18", -500, "NOPII transfer"],
    ["2026-06-19", 20, "interest"],
  ]);
  const morningKey = assignSourceTransactionKeys(
    statement.transactions,
    BASE_ACCOUNT,
  ).find((t) => t.narration === "sample morning")!.source_transaction_key!;

  const narrationsReachingTail = () =>
    draftImportCalls.at(-1)!.transactions.map((t) => t.narration);

  it("pairs the day's rows with those the books hold by key", async () => {
    await runStatementImport(
      [statement],
      options(),
      testImportLedger(BASE_ACCOUNT, {
        date: "2026-06-18",
        balance: 850,
        rows: [{ amount: -50, narration: "sample morning", key: morningKey }],
      }),
    );
    expect(narrationsReachingTail()).toEqual([
      "NOPII salary",
      "NOPII transfer",
      "interest",
    ]);
  });

  it("pairs a row posted with no key by its amount and wording", async () => {
    await runStatementImport(
      [statement],
      options(),
      testImportLedger(BASE_ACCOUNT, {
        date: "2026-06-18",
        balance: 850,
        rows: [{ amount: -50, narration: "Sample Morning" }],
      }),
    );
    expect(narrationsReachingTail()).toEqual([
      "NOPII salary",
      "NOPII transfer",
      "interest",
    ]);
  });

  it("falls back to the balance when the books hold a row the day lacks", async () => {
    await runStatementImport(
      [statement],
      options(),
      testImportLedger(BASE_ACCOUNT, {
        date: "2026-06-18",
        balance: 850,
        rows: [{ amount: -30, narration: "sample cash" }],
      }),
    );
    expect(narrationsReachingTail()).toEqual(["interest"]);
  });
});
