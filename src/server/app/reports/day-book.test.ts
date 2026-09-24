import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  gridDatasetLinkProblems,
  gridDatasetSchema,
  gridDatasetTreeProblems,
} from "@sapporta/shared/grid-dataset";
import { describe, expect, it } from "vitest";
import dayBookApi, { dayBookReport, dayLabel } from "./day-book.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";
import { openTestLedger } from "./testing.js";

/*
 * Books with both shapes the importer has written: a day's statement rows
 * grouped into one journal per direction, each narration in its line's
 * comment, and one journal per statement row, the narration as its
 * description.
 */
function sampleBooks() {
  const books = openTestLedger();
  const bank = books.addAccount({ name: "Sample Bank", account_type: "Asset" });
  const food = books.addAccount({ name: "Food", account_type: "Expense" });
  const travel = books.addAccount({ name: "Travel", account_type: "Expense" });
  const salary = books.addAccount({ name: "Salary", account_type: "Revenue" });

  const grouped = books.addJournal({
    date: "2026-01-10",
    description: "Expenses",
    entries: [
      { account_id: food, debit: 500, comment: "UPI-sample-payee-050505" },
      { account_id: travel, debit: 200, comment: "NOPII SAMPLE NARRATION" },
      { account_id: bank, credit: 700 },
    ],
  });
  const deposit = books.addJournal({
    date: "2026-01-10",
    description: "Deposits",
    entries: [
      { account_id: bank, debit: 3000 },
      { account_id: salary, credit: 3000, comment: "NEFT-sample-050505" },
    ],
  });
  const perRow = books.addJournal({
    date: "2026-01-12",
    description: "UPI-sample-payee-0505051",
    entries: [
      { account_id: food, debit: 100 },
      { account_id: bank, credit: 100 },
    ],
  });
  // Outside the period.
  books.addJournal({
    date: "2026-02-01",
    description: "NOPII LATER",
    entries: [
      { account_id: travel, debit: 50 },
      { account_id: bank, credit: 50 },
    ],
  });
  // Another user's journal in the same workspace, dated in the period.
  books.sqlite.exec(`
    INSERT INTO journals
      (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
    VALUES (9050505, 'workspace', 'other-user', '2026-01-11', 'NOPII OTHER USER', '2026-01-01', '2026-01-01');
    INSERT INTO journal_entries
      (workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
    VALUES ('workspace', 'other-user', 9050505, ${food}, 1000, 0, '2026-01-01', '2026-01-01');
  `);

  return { books, bank, food, travel, salary, grouped, deposit, perRow };
}

describe("Day Book", () => {
  it("nests each day's journals, and each journal's lines, in one tree", () => {
    const { books, food, grouped, deposit, perRow } = sampleBooks();

    const result = dayBookReport(books.ledger, {
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.rootLevel).toBe("day_book");
    expect(result.levels.day_book).toMatchObject({
      childLevels: [],
      tree: { parentColumn: "parent_key", column: "particulars" },
    });
    // Open by default: a day reads without a click.
    expect(result.levels.day_book?.defaultCollapsed).toBeUndefined();

    const rows = result.nodes.map((node) => ({
      rowKey: node.rowKey,
      parent: node.columns.parent_key,
      particulars: node.columns.particulars,
      debit: node.columns.debit,
      credit: node.columns.credit,
      comment: node.columns.comment,
    }));
    // No row for 2026-01-11: the only journal that day is someone else's.
    expect(rows).toEqual([
      {
        rowKey: "day:2026-01-10",
        parent: null,
        particulars: "Saturday, 10 January 2026",
        debit: 3700,
        credit: 3700,
        comment: undefined,
      },
      {
        rowKey: `journal:${grouped}`,
        parent: "day:2026-01-10",
        particulars: "Expenses",
        debit: undefined,
        credit: undefined,
        comment: undefined,
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${grouped}`,
        particulars: "Food",
        debit: 500,
        credit: 0,
        comment: "UPI-sample-payee-050505",
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${grouped}`,
        particulars: "Travel",
        debit: 200,
        credit: 0,
        comment: "NOPII SAMPLE NARRATION",
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${grouped}`,
        particulars: "Sample Bank",
        debit: 0,
        credit: 700,
        comment: null,
      },
      {
        rowKey: `journal:${deposit}`,
        parent: "day:2026-01-10",
        particulars: "Deposits",
        debit: undefined,
        credit: undefined,
        comment: undefined,
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${deposit}`,
        particulars: "Sample Bank",
        debit: 3000,
        credit: 0,
        comment: null,
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${deposit}`,
        particulars: "Salary",
        debit: 0,
        credit: 3000,
        comment: "NEFT-sample-050505",
      },
      {
        rowKey: "day:2026-01-12",
        parent: null,
        particulars: "Monday, 12 January 2026",
        debit: 100,
        credit: 100,
        comment: undefined,
      },
      {
        rowKey: `journal:${perRow}`,
        parent: "day:2026-01-12",
        particulars: "UPI-sample-payee-0505051",
        debit: undefined,
        credit: undefined,
        comment: undefined,
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${perRow}`,
        particulars: "Food",
        debit: 100,
        credit: 0,
        comment: null,
      },
      {
        rowKey: expect.stringMatching(/^entry:/),
        parent: `journal:${perRow}`,
        particulars: "Sample Bank",
        debit: 0,
        credit: 100,
        comment: null,
      },
    ]);

    // Links read the ids each kind of row carries: a journal row its
    // journal, a line its entry and account, a day neither.
    const byKey = new Map(result.nodes.map((node) => [node.rowKey, node]));
    expect(byKey.get("day:2026-01-10")?.columns).not.toHaveProperty(
      "journal_id",
    );
    expect(byKey.get(`journal:${grouped}`)?.columns).toMatchObject({
      journal_id: grouped,
      date: "2026-01-10",
    });
    expect(byKey.get(`journal:${grouped}`)?.columns).not.toHaveProperty(
      "account_id",
    );
    const line = result.nodes.find(
      (node) =>
        node.columns.parent_key === `journal:${grouped}` &&
        node.columns.account_id === food,
    );
    expect(line?.columns).toMatchObject({ date: "2026-01-10" });
    expect(line?.columns).not.toHaveProperty("journal_id");
    expect(line?.columns.entry_id).toEqual(expect.any(Number));

    expect(result.footerRows?.map((row) => row.columns)).toEqual([
      { particulars: "Total", debit: 3800, credit: 3800 },
    ]);
  });

  it("covers every day when the period is open-ended", () => {
    const { books } = sampleBooks();

    const result = dayBookReport(books.ledger, {
      fromDate: null,
      toDate: null,
    });

    expect(
      result.nodes
        .filter((node) => node.columns.parent_key === null)
        .map((node) => node.columns.date),
    ).toEqual(["2026-01-10", "2026-01-12", "2026-02-01"]);
  });

  it("is empty, with no total, for a period without journals", () => {
    const { books } = sampleBooks();

    const result = dayBookReport(books.ledger, {
      fromDate: "2025-01-01",
      toDate: "2025-12-31",
    });

    expect(() => gridDatasetSchema.parse(result)).not.toThrow();
    expect(result.nodes).toEqual([]);
    expect(result.footerRows).toBeUndefined();
  });
});

describe("Day Book route", () => {
  it("answers the period's day book, with links and a tree the grid accepts", async () => {
    const { books } = sampleBooks();
    const app = new TsRestApi<SapportaEnv>();
    app.use(async (c, next) => {
      c.set("sqlite", books.sqlite);
      c.set(
        "auth",
        testLedgerAuth(books.owner.scoped_to_user_id, books.owner.workspace_id),
      );
      await next();
    });
    app.route("/", dayBookApi);

    const response = await app.request(
      "/reports/day-book?from_date=2026-01-11&to_date=2026-01-31",
    );

    expect(response.status).toBe(200);
    const result = gridDatasetSchema.parse(await response.json());
    expect(gridDatasetLinkProblems(result)).toEqual([]);
    expect(gridDatasetTreeProblems(result)).toEqual([]);
    expect(
      result.nodes
        .filter((node) => node.columns.parent_key === null)
        .map((node) => node.columns.date),
    ).toEqual(["2026-01-12"]);
  });
});

describe("dayLabel", () => {
  it("names the weekday of a calendar date, whatever the machine's zone", () => {
    expect(dayLabel("2026-03-01")).toBe("Sunday, 1 March 2026");
  });
});
