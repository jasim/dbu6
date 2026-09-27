import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applyMigrations } from "@sapporta/server";
import { describe, expect, it } from "vitest";
import type {
  CategorizationLlm,
  ListRequest,
} from "../modules/categorization/index.js";
import { dbu6MigrationsDir } from "../paths.js";
import { createCommentWriter, MAX_FAILURES } from "./comment-writer.js";

const SCOPE = "'workspace', 'user'";
const AT = "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'";

/*
 * Sample Savings (1) and Eating Out (2). Two drafts share one text and a
 * third has its own; a posted row from an older import shares the first
 * text, and a day-grouped journal of older rows keeps its description.
 */
function books() {
  const sqlite = new Database(":memory:");
  applyMigrations(sqlite, dbu6MigrationsDir());
  sqlite.exec(`
    INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, account_type, created_at, updated_at) VALUES
      (1, ${SCOPE}, 'Sample Savings', 'Asset', ${AT}),
      (2, ${SCOPE}, 'Eating Out', 'Expense', ${AT});
    INSERT INTO draft_transactions (id, workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit, account_id, base_account_id, created_at, updated_at) VALUES
      (1, ${SCOPE}, '2026-02-01', 'UPI/050505000001/SAMPLE CAFE', 100, 0, 2, 1, ${AT}),
      (2, ${SCOPE}, '2026-02-02', 'UPI/050505000001/SAMPLE CAFE', 100, 0, 2, 1, ${AT}),
      (3, ${SCOPE}, '2026-02-03', 'POS 050505 SAMPLE BAKERY', 50, 0, 2, 1, ${AT});
    INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at) VALUES
      (10, ${SCOPE}, '2026-01-05', 'UPI/050505000001/SAMPLE CAFE', ${AT}),
      (11, ${SCOPE}, '2026-01-06', 'Expenses', ${AT});
    INSERT INTO journal_entries (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, source_narration, created_at, updated_at) VALUES
      (101, ${SCOPE}, 10, 2, 100, 0, 'UPI/050505000001/SAMPLE CAFE', ${AT}),
      (102, ${SCOPE}, 10, 1, 0, 100, NULL, ${AT}),
      (111, ${SCOPE}, 11, 2, 30, 0, 'NEFT SAMPLE DINER', ${AT}),
      (112, ${SCOPE}, 11, 2, 20, 0, 'NEFT SAMPLE KIOSK', ${AT}),
      (113, ${SCOPE}, 11, 1, 0, 50, NULL, ${AT});
  `);
  return { sqlite, db: drizzle(sqlite) };
}

// A readable line for each sample text, as a well-behaved LLM would answer.
const READABLE: Record<string, string> = {
  "UPI/050505000001/SAMPLE CAFE": "UPI Sample Cafe",
  "POS 050505 SAMPLE BAKERY": "POS Sample Bakery",
  "NEFT SAMPLE DINER": "NEFT Sample Diner",
  "NEFT SAMPLE KIOSK": "NEFT Sample Kiosk",
};

type Answer = (text: string) => string | undefined;

/** An engine that answers each text with `answer`, and records its calls. */
function fakeLlm(
  answer: Answer = (text) => READABLE[text],
  options: {
    failCalls?: boolean;
    unavailable?: string | null;
    beforeAnswer?: () => void;
  } = {},
) {
  const calls: string[][] = [];
  const llm: CategorizationLlm = {
    agent: "claude-code",
    name: "Sample agent",
    caller: {
      ready: true,
      maxRowsPerCall: 50,
      confirmUnavailable: async () => options.unavailable ?? null,
      client: {
        async list(request: ListRequest) {
          calls.push(request.rows.map((row) => row.text));
          options.beforeAnswer?.();
          if (options.failCalls) return { ok: false, error: "sample failure" };
          return {
            ok: true,
            rows: request.rows.flatMap((row) => {
              const comment = answer(row.text);
              return comment === undefined ? [] : [{ id: row.id, comment }];
            }),
          };
        },
      },
    },
  };
  return { llm, calls };
}

function writerOn(
  db: ReturnType<typeof books>["db"],
  llm: CategorizationLlm,
  categorizationIdle: () => Promise<void> = () => Promise.resolve(),
) {
  return createCommentWriter({
    db,
    llm: async () => llm,
    categorizationIdle,
  });
}

const comments = (sqlite: Database.Database, table: string) =>
  sqlite.prepare(`SELECT id, comment FROM ${table} ORDER BY id`).all();

describe("the comment writer", () => {
  it("fills every null comment, one answer for each text, drafts first", async () => {
    const { sqlite, db } = books();
    const { llm, calls } = fakeLlm();
    const writer = writerOn(db, llm);

    writer.trigger();
    await writer.settled();

    expect(calls).toEqual([
      [
        "UPI/050505000001/SAMPLE CAFE",
        "POS 050505 SAMPLE BAKERY",
        "NEFT SAMPLE DINER",
        "NEFT SAMPLE KIOSK",
      ],
    ]);
    expect(comments(sqlite, "draft_transactions")).toEqual([
      { id: 1, comment: "UPI Sample Cafe" },
      { id: 2, comment: "UPI Sample Cafe" },
      { id: 3, comment: "POS Sample Bakery" },
    ]);
    expect(comments(sqlite, "journal_entries")).toEqual([
      { id: 101, comment: "UPI Sample Cafe" },
      { id: 102, comment: null },
      { id: 111, comment: "NEFT Sample Diner" },
      { id: 112, comment: "NEFT Sample Kiosk" },
      { id: 113, comment: null },
    ]);
    expect(writer.status()).toEqual({
      running: false,
      pending: 0,
      failed: 0,
      last_error: null,
    });
  });

  it("describes a one-row journal by its comment, and leaves an older day's group", async () => {
    const { sqlite, db } = books();
    const writer = writerOn(db, fakeLlm().llm);

    writer.trigger();
    await writer.settled();

    expect(
      sqlite.prepare("SELECT id, description FROM journals ORDER BY id").all(),
    ).toEqual([
      { id: 10, description: "UPI Sample Cafe" },
      { id: 11, description: "Expenses" },
    ]);
  });

  it("writes only null comments, and keeps one typed while it ran", async () => {
    const { sqlite, db } = books();
    sqlite.exec(
      `UPDATE draft_transactions SET comment = 'sample lunch' WHERE id = 1`,
    );
    // The person types a comment on draft 2 while the call is out.
    const { llm } = fakeLlm(undefined, {
      beforeAnswer: () =>
        sqlite.exec(
          `UPDATE draft_transactions SET comment = 'sample typed' WHERE id = 2`,
        ),
    });
    const writer = writerOn(db, llm);

    writer.trigger();
    await writer.settled();

    expect(comments(sqlite, "draft_transactions")).toEqual([
      { id: 1, comment: "sample lunch" },
      { id: 2, comment: "sample typed" },
      { id: 3, comment: "POS Sample Bakery" },
    ]);
    // The entry with the same text had no comment, so it gets the answer.
    expect(comments(sqlite, "journal_entries")[0]).toEqual({
      id: 101,
      comment: "UPI Sample Cafe",
    });
  });

  it("leaves a text after three failed answers, until Retry", async () => {
    const { sqlite, db } = books();
    // Every answer for the bakery keeps its reference number.
    const { llm, calls } = fakeLlm((text) =>
      text === "POS 050505 SAMPLE BAKERY"
        ? "POS 050505123 Bakery"
        : READABLE[text],
    );
    const writer = writerOn(db, llm);

    for (let run = 0; run < MAX_FAILURES + 1; run++) {
      writer.trigger();
      await writer.settled();
    }

    // Once with the rest, twice alone, and then no more.
    expect(calls).toEqual([
      [
        "UPI/050505000001/SAMPLE CAFE",
        "POS 050505 SAMPLE BAKERY",
        "NEFT SAMPLE DINER",
        "NEFT SAMPLE KIOSK",
      ],
      ["POS 050505 SAMPLE BAKERY"],
      ["POS 050505 SAMPLE BAKERY"],
    ]);
    expect(comments(sqlite, "draft_transactions")[2]).toEqual({
      id: 3,
      comment: null,
    });
    expect(writer.status()).toMatchObject({ pending: 0, failed: 1 });

    writer.retry();
    await writer.settled();
    expect(calls).toHaveLength(MAX_FAILURES + 1);
  });

  it("stops the run, counting nothing, when the agent isn't answering", async () => {
    const { sqlite, db } = books();
    // More than one call's worth, so there would be more to send.
    const insert = sqlite.prepare(
      `INSERT INTO draft_transactions (workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit, base_account_id, created_at, updated_at)
       VALUES ('workspace', 'user', '2026-02-04', ?, 10, 0, 1, ${AT})`,
    );
    for (let n = 0; n < 60; n++) insert.run(`NOPII SAMPLE SHOP ${n}`);
    const { llm, calls } = fakeLlm(undefined, {
      failCalls: true,
      unavailable: "Sample agent isn't answering.",
    });
    const writer = writerOn(db, llm);

    writer.trigger();
    await writer.settled();

    expect(calls).toHaveLength(1);
    expect(writer.status()).toEqual({
      running: false,
      pending: 64,
      failed: 0,
      last_error: "Sample agent isn't answering.",
    });
  });

  it("counts a failed call against its texts when the agent still answers", async () => {
    const { db } = books();
    const { llm } = fakeLlm(undefined, { failCalls: true, unavailable: null });
    const writer = writerOn(db, llm);

    for (let run = 0; run < MAX_FAILURES; run++) {
      writer.trigger();
      await writer.settled();
    }

    expect(writer.status()).toEqual({
      running: false,
      pending: 0,
      failed: 4,
      last_error: null,
    });
  });

  it("starts no call while categorization runs", async () => {
    const { sqlite, db } = books();
    const { llm, calls } = fakeLlm();
    let idle!: () => void;
    const categorizing = new Promise<void>((resolve) => (idle = resolve));
    const writer = writerOn(db, llm, () => categorizing);

    writer.trigger();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual([]);
    expect(writer.status().running).toBe(true);

    idle();
    await writer.settled();
    expect(calls).toHaveLength(1);
    expect(comments(sqlite, "draft_transactions")[0]).toEqual({
      id: 1,
      comment: "UPI Sample Cafe",
    });
  });

  it("goes round again for a trigger that came during a run", async () => {
    const { sqlite, db } = books();
    let added = false;
    const { llm, calls } = fakeLlm(undefined, {
      beforeAnswer: () => {
        if (added) return;
        added = true;
        sqlite.exec(`
          INSERT INTO draft_transactions (workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit, base_account_id, created_at, updated_at)
          VALUES ('workspace', 'user', '2026-02-05', 'NEFT SAMPLE DINER', 30, 0, 1, ${AT}),
                 ('workspace', 'user', '2026-02-05', 'NOPII SAMPLE MARKET', 40, 0, 1, ${AT})
        `);
        writer.trigger();
      },
    });
    const writer = writerOn(db, llm);

    writer.trigger();
    await writer.settled();

    expect(calls[1]).toEqual(["NOPII SAMPLE MARKET"]);
    expect(
      sqlite
        .prepare(
          "SELECT comment FROM draft_transactions WHERE source_narration = 'NEFT SAMPLE DINER'",
        )
        .get(),
    ).toEqual({ comment: "NEFT Sample Diner" });
  });
});
