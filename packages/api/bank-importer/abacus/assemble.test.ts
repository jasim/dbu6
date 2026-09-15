import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assembleStatements,
  normalizeChronological,
  partEdges,
  synthesizeRunningBalances,
  validatePart,
  verifyClosingBalance,
  type Abacus,
  type AbacusStatement,
} from "./index.js";
import {
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
} from "../import-errors.js";

// [date, signed amount, printed balance or null, narration?]
type Row = [string, number, number | null, string?];

function rows(spec: Row[]): Abacus[] {
  return spec.map(([date, amount, balance, narration], i) => ({
    date,
    narration: narration ?? `row ${i + 1}`,
    withdrawal: amount < 0 ? -amount : 0,
    deposit: amount > 0 ? amount : 0,
    balance,
  }));
}

function part(
  spec: Row[],
  edges: { opening?: number | null; closing?: number | null } = {},
): AbacusStatement {
  return {
    transactions: normalizeChronological(rows(spec), "ascending"),
    opening: edges.opening ?? null,
    closing: edges.closing ?? null,
    account: null,
    institution: null,
  };
}

// A bank part: every row prints its running balance, walked from `opening`.
function bank(
  opening: number,
  spec: Array<[string, number, string?]>,
  declared: { opening?: boolean; closing?: boolean } = {},
): AbacusStatement {
  let balance = opening;
  const printed: Row[] = spec.map(([date, amount, narration]) => {
    balance += amount;
    return [date, amount, balance, narration];
  });
  return part(printed, {
    opening: declared.opening ? opening : null,
    closing: declared.closing ? balance : null,
  });
}

// A card cycle: no row balances, declared opening and closing.
function card(opening: number, spec: Array<[string, number, string?]>) {
  const closing = spec.reduce((sum, [, amount]) => sum + amount, opening);
  return part(
    spec.map(([date, amount, narration]) => [date, amount, null, narration]),
    { opening, closing },
  );
}

function stmt(
  dates: string[],
  opening: number | null,
  closing: number | null,
): AbacusStatement {
  return part(
    dates.map((d) => [d, 100, null]),
    { opening, closing },
  );
}

function narrations(statement: AbacusStatement): string[] {
  return statement.transactions.map((t) => t.narration);
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("partEdges", () => {
  it("derives both edges from printed rows when nothing is declared", () => {
    const federal = bank(1000, [
      ["2026-01-01", -100],
      ["2026-01-02", 250],
    ]);
    expect(partEdges(federal)).toEqual({
      start: 1000,
      end: 1150,
      printsEveryRow: true,
    });
  });

  it("prefers the rows over declared edges that differ within the tolerance", () => {
    const rowsSay = bank(1000, [["2026-01-01", -100]]);
    const declaredSlightlyOff = { ...rowsSay, opening: 1000.5, closing: 899.5 };
    expect(() => validatePart(declaredSlightlyOff, "a")).not.toThrow();
    expect(partEdges(declaredSlightlyOff)).toMatchObject({
      start: 1000,
      end: 900,
    });
  });

  it("fails validation by name when declared edges disagree beyond the tolerance", () => {
    const rowsSay = bank(1000, [["2026-01-01", -100]]);
    expect(() =>
      validatePart({ ...rowsSay, opening: 1002 }, "jan.xls"),
    ).toThrow(StatementPartInvalidError);
    expect(() => validatePart({ ...rowsSay, closing: 950 }, "jan.xls")).toThrow(
      /jan\.xls/,
    );
  });

  it("reconstructs the start from a declared closing and the net", () => {
    const stanc = part(
      [
        ["2026-01-01", -100, null],
        ["2026-01-02", 250, null],
      ],
      { closing: 1150 },
    );
    expect(partEdges(stanc)).toEqual({
      start: 1000,
      end: 1150,
      printsEveryRow: false,
    });
  });

  it("reports no edges for a part with no anchor", () => {
    const unanchored = part([["2026-01-01", -100, null]]);
    expect(partEdges(unanchored)).toEqual({
      start: null,
      end: null,
      printsEveryRow: false,
    });
  });

  it("marks a part with a blank balance cell as not printing every row", () => {
    const patchy = part(
      [
        ["2026-01-01", -100, 900],
        ["2026-01-02", 250, null],
      ],
      {},
    );
    expect(partEdges(patchy)).toEqual({
      start: 1000,
      end: 1150,
      printsEveryRow: false,
    });
  });
});

describe("assembleStatements", () => {
  it("returns the sole part as-is (fast path, no reordering) when length is 1", () => {
    const only = stmt(["2025-01-01", "2025-01-02"], 1000, 1200);
    expect(assembleStatements([only])).toBe(only);
  });

  it("accepts a part with no anchor when it is the only non-empty part", () => {
    const unanchored = part([["2026-01-01", -100, null]]);
    const empty = stmt([], null, null);
    expect(assembleStatements([empty, unanchored])).toBe(unanchored);
  });

  it("orders files by earliest transaction date and joins them by balance", () => {
    const a = stmt(["2025-02-01"], 1100, 1200);
    const b = stmt(["2025-01-01"], 1000, 1100);
    const merged = assembleStatements([a, b]);
    expect(merged.transactions.map((t) => t.date)).toEqual([
      "2025-01-01",
      "2025-02-01",
    ]);
  });

  it("takes opening from the first part, closing from the last, drops intermediates", () => {
    const jan = stmt(["2025-01-15"], 1000, 1100);
    const feb = stmt(["2025-02-15"], 1100, 1200);
    const mar = stmt(["2025-03-15"], 1200, 1300);
    const merged = assembleStatements([mar, jan, feb]);
    expect(merged.opening).toBe(1000);
    expect(merged.closing).toBe(1300);
  });

  it("skips empty-transaction files when ordering", () => {
    const empty = stmt([], 99, 99);
    const real = stmt(["2025-01-01"], 1000, 1100);
    const merged = assembleStatements([empty, real]);
    expect(merged.opening).toBe(1000);
    expect(merged.closing).toBe(1100);
  });

  it("allows adjacent non-overlapping ranges", () => {
    const a = stmt(["2025-01-01", "2025-01-31"], 1000, 1200);
    const b = stmt(["2025-02-01", "2025-02-28"], 1200, 1400);
    expect(assembleStatements([a, b]).transactions.map((t) => t.date)).toEqual([
      "2025-01-01",
      "2025-01-31",
      "2025-02-01",
      "2025-02-28",
    ]);
  });

  it("chains four monthly credit-card statement boundaries", () => {
    const parts = [
      card(-10000.5, [["2026-02-28", 4000.25]]),
      card(-6000.25, [["2026-03-31", -500.5]]),
      card(-6500.75, [["2026-04-30", -1500.5]]),
      card(-8001.25, [["2026-05-31", -2000.25]]),
    ];
    const merged = assembleStatements(parts);
    const filled = synthesizeRunningBalances(
      merged.transactions,
      merged.opening,
    );
    verifyClosingBalance(filled, merged.closing);
    expect(filled.at(-1)?.balance).toBeCloseTo(-10001.5, 2);
  });
});

describe("shared days", () => {
  const boundary: Array<[string, number, string?]> = [
    ["2026-06-18", -300, "coffee"],
    ["2026-06-18", 5000, "salary"],
  ];

  it("drops a boundary day printed in full by both parts", () => {
    const june = bank(10000, [["2026-06-17", -1000, "rent"], ...boundary]);
    const july = bank(9000, [...boundary, ["2026-06-19", -200, "lunch"]]);
    const merged = assembleStatements([june, july], ["june", "july"]);
    expect(narrations(merged)).toEqual(["rent", "coffee", "salary", "lunch"]);
    expect(merged.transactions.at(-1)?.balance).toBe(13500);
  });

  it("drops a shared day whose net is zero without any tie-break", () => {
    const wash: Array<[string, number, string?]> = [
      ["2026-06-18", 50, "in"],
      ["2026-06-18", -50, "out"],
      ["2026-06-18", 50, "in again"],
    ];
    const a = bank(1000, [["2026-06-17", -100, "before"], ...wash]);
    const b = bank(900, [...wash, ["2026-06-19", -100, "after"]]);
    const merged = assembleStatements([a, b]);
    expect(narrations(merged)).toEqual([
      "before",
      "in",
      "out",
      "in again",
      "after",
    ]);
  });

  it("keeps the rest of a day the first part cut mid-way through", () => {
    const cut = bank(10000, [["2026-06-17", -1000, "rent"], boundary[0]]);
    const full = bank(9000, [...boundary, ["2026-06-19", -200, "lunch"]]);
    const merged = assembleStatements([cut, full], ["cut", "full"]);
    expect(narrations(merged)).toEqual(["rent", "coffee", "salary", "lunch"]);
  });

  it("takes nothing from a second part cut inside a day the first prints in full", () => {
    const full = bank(10000, [["2026-06-17", -1000, "rent"], ...boundary]);
    const cut = bank(9000, [boundary[0]]);
    const merged = assembleStatements([full, cut]);
    expect(narrations(merged)).toEqual(["rent", "coffee", "salary"]);
  });

  it("handles containment in both directions", () => {
    const threeWeeks = bank(1000, [
      ["2026-06-01", -10, "w1"],
      ["2026-06-08", -20, "w2"],
      ["2026-06-15", -30, "w3"],
    ]);
    const twoWeeks = bank(990, [
      ["2026-06-08", -20, "w2"],
      ["2026-06-15", -30, "w3"],
    ]);
    expect(narrations(assembleStatements([threeWeeks, twoWeeks]))).toEqual([
      "w1",
      "w2",
      "w3",
    ]);
    expect(narrations(assembleStatements([twoWeeks, threeWeeks]))).toEqual([
      "w1",
      "w2",
      "w3",
    ]);
  });

  it("joins a three-part lattice where the first contains the second and still overlaps the third", () => {
    const first = bank(1000, [
      ["2026-06-01", -10, "a"],
      ["2026-06-08", -20, "b"],
      ["2026-06-15", -30, "c"],
    ]);
    const second = bank(990, [["2026-06-08", -20, "b"]]);
    const third = bank(970, [
      ["2026-06-15", -30, "c"],
      ["2026-06-22", -40, "d"],
    ]);
    const merged = assembleStatements(
      [third, second, first],
      ["third", "second", "first"],
    );
    expect(narrations(merged)).toEqual(["a", "b", "c", "d"]);
    expect(merged.transactions.at(-1)?.balance).toBe(900);
  });

  it("drops a two-week export overlapping a three-week one", () => {
    const three = bank(1000, [
      ["2026-06-01", -10, "a"],
      ["2026-06-08", -20, "b"],
      ["2026-06-15", -30, "c"],
    ]);
    const two = bank(970, [
      ["2026-06-15", -30, "c"],
      ["2026-06-22", -40, "d"],
    ]);
    expect(narrations(assembleStatements([three, two]))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("refuses a shared day worded differently, naming the day and the first differing row", () => {
    const a = bank(1000, [
      ["2026-06-17", -100, "before"],
      ["2026-06-18", -300, "COFFEE SHOP"],
      ["2026-06-19", 10, "after"],
    ]);
    const b = bank(900, [
      ["2026-06-18", -300, "Coffee Shop Ltd"],
      ["2026-06-19", 10, "after"],
    ]);
    let error: unknown;
    try {
      assembleStatements([a, b], ["a.csv", "b.csv"]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(StatementDisagreementError);
    const disagreement = error as StatementDisagreementError;
    expect(disagreement.date).toBe("2026-06-18");
    expect(disagreement.parts).toEqual(["a.csv", "b.csv"]);
    expect(disagreement.row).toMatchObject({
      part: "b.csv",
      narration: "Coffee Shop Ltd",
      withdrawal: 300,
    });
    expect(disagreement.toPayload()).toMatchObject({
      error: "statement_disagreement",
      date: "2026-06-18",
    });
  });

  it("refuses a middle day the earlier part holds only a prefix of, without waiting for the chain", () => {
    const earlier = bank(1000, [
      ["2026-06-17", -100, "x"],
      ["2026-06-18", -300, "coffee"],
      ["2026-06-19", 10, "z"],
    ]);
    const later = bank(900, [
      ["2026-06-18", -300, "coffee"],
      ["2026-06-18", 5000, "salary"],
      ["2026-06-19", 10, "z"],
    ]);
    expect(() => assembleStatements([earlier, later], ["e", "l"])).toThrow(
      StatementDisagreementError,
    );
    try {
      assembleStatements([earlier, later], ["e", "l"]);
    } catch (err) {
      expect((err as StatementDisagreementError).date).toBe("2026-06-18");
      expect((err as StatementDisagreementError).row).toMatchObject({
        narration: "salary",
      });
    }
  });

  it("keeps both of two textually identical rows on one day, one per part", () => {
    const cut = bank(1000, [["2026-06-18", -50, "auto-debit"]]);
    const full = bank(1000, [
      ["2026-06-18", -50, "auto-debit"],
      ["2026-06-18", -50, "auto-debit"],
    ]);
    const merged = assembleStatements([cut, full]);
    expect(merged.transactions.map((t) => t.balance)).toEqual([950, 900]);
  });
});

describe("chain", () => {
  it("chains forward across a split day with no shared rows, keeping every row", () => {
    const morning = bank(1000, [
      ["2026-06-17", -100, "a"],
      ["2026-06-18", -300, "b"],
    ]);
    const afternoon = bank(600, [
      ["2026-06-18", 5000, "c"],
      ["2026-06-19", -20, "d"],
    ]);
    const merged = assembleStatements([morning, afternoon]);
    expect(narrations(merged)).toEqual(["a", "b", "c", "d"]);
    expect(merged.transactions.at(-1)?.balance).toBe(5580);
  });

  it("chains two card cycles where the later holds a row dated inside the earlier", () => {
    const aug = card(-1000, [
      ["2026-07-05", -500, "fee"],
      ["2026-08-01", -200, "shop"],
    ]);
    const sep = card(-1700, [
      ["2026-08-04", -90, "igst on fee"],
      ["2026-08-20", -100, "shop"],
    ]);
    const merged = assembleStatements([aug, sep], ["aug", "sep"]);
    expect(merged.transactions).toHaveLength(4);
    expect(merged.opening).toBe(-1000);
    expect(merged.closing).toBe(-1890);
  });

  it("is never ambiguous when the second part's net is minus the first's", () => {
    const jan = card(0, [["2026-01-31", 20000, "payment"]]);
    const feb = card(20000, [["2026-02-28", -20000, "spend"]]);
    const merged = assembleStatements([jan, feb], ["jan", "feb"]);
    expect(narrations(merged)).toEqual(["payment", "spend"]);
    expect(merged.opening).toBe(0);
    expect(merged.closing).toBe(0);
  });

  it("prepends a cycle whose late-posted row sorts it before the cycle it follows", () => {
    const earlier = card(-1000, [["2026-07-10", -200, "shop"]]);
    const later = card(-1200, [
      ["2026-07-05", -50, "late fee"],
      ["2026-08-10", -100, "shop again"],
    ]);
    const merged = assembleStatements([earlier, later], ["earlier", "later"]);
    expect(merged.opening).toBe(-1000);
    expect(merged.closing).toBe(-1350);
    expect(narrations(merged)).toEqual(["late fee", "shop", "shop again"]);
  });

  it("defers a cycle posted two cycles late until its neighbours are in the run", () => {
    const c1 = card(-1000, [["2026-06-10", -100, "c1"]]);
    const c2 = card(-1100, [["2026-07-10", -100, "c2"]]);
    const c3 = card(-1200, [
      ["2026-06-05", -10, "posted two cycles late"],
      ["2026-08-10", -100, "c3"],
    ]);
    const merged = assembleStatements([c1, c2, c3], ["c1", "c2", "c3"]);
    expect(merged.opening).toBe(-1000);
    expect(merged.closing).toBe(-1310);
    expect(merged.transactions).toHaveLength(4);
  });

  it("chains a same-day fragment forward into the part that continues past it", () => {
    const fragment = bank(1000, [["2026-06-18", -100, "first"]]);
    const rest = bank(900, [
      ["2026-06-18", -200, "second"],
      ["2026-06-19", 50, "third"],
    ]);
    const merged = assembleStatements([rest, fragment]);
    expect(narrations(merged)).toEqual(["first", "second", "third"]);
  });
});

describe("refusals", () => {
  it("refuses two parts that disagree about a day both cover", () => {
    const a = bank(1000, [
      ["2026-06-17", -100, "x"],
      ["2026-06-18", -300, "coffee"],
    ]);
    const b = bank(900, [
      ["2026-06-18", -250, "coffee"],
      ["2026-06-19", 10, "z"],
    ]);
    expect(() => assembleStatements([a, b])).toThrow(
      StatementDisagreementError,
    );
  });

  it("refuses non-chaining edges with disjoint dates as a gap with the signed delta", () => {
    const jan = stmt(["2025-01-31"], 1000, 1100);
    const feb = stmt(["2025-02-28"], 1200, 1300);
    let error: unknown;
    try {
      assembleStatements([jan, feb], ["jan", "feb"]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(StatementBoundaryMismatchError);
    const gap = error as StatementBoundaryMismatchError;
    expect(gap.earlierSource).toBe("jan");
    expect(gap.laterSource).toBe("feb");
    expect(gap.earlierClosing).toBe(1100);
    expect(gap.laterOpening).toBe(1200);
    expect(gap.difference).toBe(100);
    expect(gap.hint).toBeNull();
    expect(gap.message).toContain("jan ends at 1100");
    expect(gap.message).toContain("feb starts at 1200");
  });

  it("reports the signed delta the other way when the missing activity is negative", () => {
    const jan = stmt(["2025-01-31"], 1000, 1100);
    const feb = stmt(["2025-02-28"], 1050, 1150);
    expect(() => assembleStatements([jan, feb], ["jan", "feb"])).toThrow(
      /nets to -50/,
    );
  });

  it("hints that two card parts with the same dates, rows and edges are one statement twice", () => {
    const cycle = card(-1000, [
      ["2026-07-05", -500, "fee"],
      ["2026-07-20", -200, "shop"],
    ]);
    let error: unknown;
    try {
      assembleStatements([cycle, { ...cycle }], ["july.csv", "july.xls"]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(StatementBoundaryMismatchError);
    expect((error as StatementBoundaryMismatchError).hint).toMatch(
      /same statement uploaded twice/,
    );
    expect((error as StatementBoundaryMismatchError).toPayload()).toMatchObject(
      {
        error: "statement_boundary_mismatch",
        reason: "same-statement-twice",
        hint: expect.any(String),
      },
    );
  });

  it("joins the parts that chain, then refuses the one that chains to nothing as a gap", () => {
    const jan = stmt(["2025-01-31"], 1000, 1100);
    const feb = stmt(["2025-02-28"], 1100, 1200);
    const stray = stmt(["2025-04-30"], 5000, 5100);
    let error: unknown;
    try {
      assembleStatements([stray, jan, feb], ["stray", "jan", "feb"]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(StatementBoundaryMismatchError);
    const gap = error as StatementBoundaryMismatchError;
    expect(gap.reason).toBe("gap");
    expect(gap.earlierSource).toBe("feb");
    expect(gap.laterSource).toBe("stray");
    expect(gap.difference).toBe(3800);
  });

  it("refuses a part with no anchor when another part is present, naming it", () => {
    const anchored = bank(1000, [["2026-06-17", -100, "x"]]);
    const unanchored = part([["2026-06-18", -100, null]]);
    let error: unknown;
    try {
      assembleStatements([anchored, unanchored], ["a.csv", "page-2.pdf"]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(StatementPartUnjoinableError);
    expect((error as StatementPartUnjoinableError).part).toBe("page-2.pdf");
    expect((error as StatementPartUnjoinableError).message).toMatch(
      /combine the pages into one file/,
    );
  });

  it("blames a part that fails its own validation by name", () => {
    const good = bank(1000, [["2026-06-17", -100, "x"]]);
    const bad = { ...bank(900, [["2026-06-18", -100, "y"]]), closing: 500 };
    expect(() => assembleStatements([good, bad], ["good", "bad"])).toThrow(
      StatementPartInvalidError,
    );
    try {
      assembleStatements([good, bad], ["good", "bad"]);
    } catch (err) {
      const invalid = err as StatementPartInvalidError;
      expect(invalid.part).toBe("bad");
      expect(invalid.toPayload()).toMatchObject({
        error: "statement_part_invalid",
        part: "bad",
        cause: { error: "balance_mismatch" },
      });
    }
  });
});
