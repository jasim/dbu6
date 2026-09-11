import { describe, it, expect } from "vitest";
import {
  detectCsv,
  chunk,
  indexCsvRecords,
  assembleCsvResults,
  applyCreditCardSignFlip,
  normalizeExtractedTransactions,
  type CsvRowExtraction,
  type StatementData,
} from "./freeform-text.js";
import { normalizeChronological } from "../balance-math.js";

describe("detectCsv", () => {
  it("accepts well-formed CSV with ≥3 columns", () => {
    const text = "Date,Description,Amount\n2025-01-01,Coffee,-150\n";
    const d = detectCsv(text);
    expect(d.kind).toBe("csv");
    if (d.kind === "csv") {
      expect(d.rows).toBe(1);
      expect(d.columns).toEqual(["Date", "Description", "Amount"]);
      expect(d.records[0]).toEqual({
        Date: "2025-01-01",
        Description: "Coffee",
        Amount: "-150",
      });
    }
  });

  it("preserves embedded newlines inside quoted fields", () => {
    const text =
      'Date,Description,Amount\n2025-01-01,"UPI payment\nto vendor",100\n';
    const d = detectCsv(text);
    expect(d.kind).toBe("csv");
    if (d.kind === "csv") {
      expect(d.rows).toBe(1);
      expect(d.records[0].Description).toBe("UPI payment\nto vendor");
    }
  });

  it("preserves values under blank headings with synthetic column names", () => {
    const text =
      ',description,transaction reference,"rewards\nearned",rewards type,"international\namount",\n' +
      '070526,"NONPII MERCH, INC, SAMPLE",05050500000000000000001,13,001,USD 505.05,1050505.56\n';
    const d = detectCsv(text);
    expect(d.kind).toBe("csv");
    if (d.kind === "csv") {
      expect(d.columns).toEqual([
        "column_1",
        "description",
        "transaction reference",
        "rewards\nearned",
        "rewards type",
        "international\namount",
        "column_7",
      ]);
      expect(d.records[0]).toEqual({
        column_1: "070526",
        description: "NONPII MERCH, INC, SAMPLE",
        "transaction reference": "05050500000000000000001",
        "rewards\nearned": "13",
        "rewards type": "001",
        "international\namount": "USD 505.05",
        column_7: "1050505.56",
      });
    }
  });

  it("preserves duplicate named columns with a synthetic suffix", () => {
    const text =
      "Date,Description,Amount,Amount\n2025-01-01,Coffee,USD 1.80,150\n";
    const d = detectCsv(text);
    expect(d.kind).toBe("csv");
    if (d.kind === "csv") {
      expect(d.columns).toEqual([
        "Date",
        "Description",
        "Amount",
        "Amount__column_4",
      ]);
      expect(d.records[0]).toEqual({
        Date: "2025-01-01",
        Description: "Coffee",
        Amount: "USD 1.80",
        Amount__column_4: "150",
      });
    }
  });

  it("rejects input with fewer than 3 columns", () => {
    const text = "Date,Amount\n2025-01-01,100\n";
    const d = detectCsv(text);
    expect(d.kind).toBe("not-csv");
    if (d.kind === "not-csv") expect(d.reason).toMatch(/2 column\(s\)/);
  });

  it("rejects header-only input (no data rows)", () => {
    const d = detectCsv("Date,Description,Amount\n");
    expect(d.kind).toBe("not-csv");
    if (d.kind === "not-csv") expect(d.reason).toMatch(/header only/);
  });

  it("rejects input with inconsistent column counts", () => {
    const text = "Date,Description,Amount\n2025-01-01,Coffee,-150,EXTRA\n";
    const d = detectCsv(text);
    expect(d.kind).toBe("not-csv");
    if (d.kind === "not-csv") expect(d.reason).toMatch(/parse error/);
  });
});

describe("chunk", () => {
  it("splits evenly when size divides length", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("leaves a smaller tail when size does not divide length", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when items.length ≤ size", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns [] for empty input", () => {
    expect(chunk([], 5)).toEqual([]);
  });
});

describe("indexCsvRecords", () => {
  it("attaches sequential csvRowIndex starting at 0, preserving fields", () => {
    const records = [
      { Date: "2025-01-01", Desc: "A" },
      { Date: "2025-01-02", Desc: "B" },
    ];
    expect(indexCsvRecords(records)).toEqual([
      { csvRowIndex: 0, Date: "2025-01-01", Desc: "A" },
      { csvRowIndex: 1, Date: "2025-01-02", Desc: "B" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(indexCsvRecords([])).toEqual([]);
  });
});

describe("assembleCsvResults", () => {
  const mkRow = (
    i: number,
    t: CsvRowExtraction["transaction"],
  ): CsvRowExtraction => ({ csvRowIndex: i, transaction: t });

  it("flattens chunks, sorts by csvRowIndex, drops nulls", () => {
    const chunks: CsvRowExtraction[][] = [
      [
        mkRow(2, {
          date: "2025-01-03",
          narration: "C",
          withdrawal: 0,
          deposit: 300,
          balance: null,
        }),
        mkRow(3, null),
      ],
      [
        mkRow(0, {
          date: "2025-01-01",
          narration: "A",
          withdrawal: 100,
          deposit: 0,
          balance: 900,
        }),
        mkRow(1, {
          date: "2025-01-02",
          narration: "B",
          withdrawal: 0,
          deposit: 200,
          balance: 1100,
        }),
      ],
    ];
    const { transactions, skipped } = assembleCsvResults(chunks);
    expect(transactions.map((t) => t.narration)).toEqual(["A", "B", "C"]);
    expect(skipped).toBe(1);
  });

  it("returns empty when all chunks are empty", () => {
    expect(assembleCsvResults([])).toEqual({ transactions: [], skipped: 0 });
  });

  it("reports skipped count when every row is null", () => {
    const chunks: CsvRowExtraction[][] = [[mkRow(0, null), mkRow(1, null)]];
    expect(assembleCsvResults(chunks)).toEqual({
      transactions: [],
      skipped: 2,
    });
  });
});

describe("applyCreditCardSignFlip", () => {
  const base: StatementData = {
    transactions: normalizeChronological(
      [
        {
          date: "2025-01-01",
          narration: "t1",
          withdrawal: 500,
          deposit: 0,
          balance: 9500,
        },
        {
          date: "2025-01-02",
          narration: "t2",
          withdrawal: 0,
          deposit: 200,
          balance: null,
        },
      ],
      "ascending",
    ),
    opening: 10000,
    closing: 9500,
    account: null,
    institution: null,
  };

  it("is an identity when isCreditCard is false", () => {
    expect(applyCreditCardSignFlip(base, false)).toEqual(base);
  });

  it("flips balances (opening/closing/per-row) but not withdrawal/deposit", () => {
    const flipped = applyCreditCardSignFlip(base, true);
    expect(flipped.opening).toBe(-10000);
    expect(flipped.closing).toBe(-9500);
    expect(flipped.transactions[0].balance).toBe(-9500);
    expect(flipped.transactions[0].withdrawal).toBe(500);
    expect(flipped.transactions[0].deposit).toBe(0);
    expect(flipped.transactions[1].balance).toBeNull();
  });

  it("leaves null balances null on flip", () => {
    const allNull: StatementData = {
      ...base,
      transactions: normalizeChronological(
        [{ ...base.transactions[0], balance: null }],
        "ascending",
      ),
      opening: null,
      closing: null,
      account: null,
      institution: null,
    };
    const flipped = applyCreditCardSignFlip(allNull, true);
    expect(flipped.opening).toBeNull();
    expect(flipped.closing).toBeNull();
    expect(flipped.transactions[0].balance).toBeNull();
  });
});

describe("normalizeExtractedTransactions", () => {
  const transaction = (
    date: string,
    narration: string,
    balance: number | null = null,
  ) => ({
    date,
    narration,
    withdrawal: 100,
    deposit: 0,
    balance,
  });

  it("accepts date-grouped sections when rows have no printed balances", () => {
    const transactions = [
      transaction("2026-04-03", "domestic-early"),
      transaction("2026-04-18", "domestic-late"),
      transaction("2026-04-10", "international-early"),
      transaction("2026-04-11", "international-late"),
    ];

    expect(
      normalizeExtractedTransactions(transactions).map((t) => t.narration),
    ).toEqual([
      "domestic-early",
      "international-early",
      "international-late",
      "domestic-late",
    ]);
  });

  it("still rejects mixed ordering when any row has a printed balance", () => {
    const transactions = [
      transaction("2026-04-03", "first", 900),
      transaction("2026-04-18", "second", 800),
      transaction("2026-04-10", "third", 700),
    ];

    expect(() => normalizeExtractedTransactions(transactions)).toThrow(
      /Cannot determine statement order/,
    );
  });
});
