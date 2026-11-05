import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { findFailingChecks } from "../modules/drafts/index.js";
import { countPostedAssertionFailures } from "../modules/reconciliation/index.js";
import { lookupLastReconciled } from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import {
  changeOpeningBalance,
  loadOpeningBalances,
  recordOpeningBalance,
  removeOpeningBalance,
} from "./opening-balances.js";
import { postPress } from "./posting.js";

/*
 * Sample Savings (2, under Assets 1) has two drafts from its statement: 500 in
 * on 3 February and 200 out on 5 February, where the statement printed 1,300.
 * So it opened at 1,000, and with nothing in the books its check fails by
 * that. Sample Card (4, under Liabilities 3) has nothing yet, and Groceries
 * (5) is an expense. There is no Equity account.
 */
function books(extra = ""): Ledger {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, 'workspace', 'user', 'Assets', NULL, 'Asset', '', ''),
      (2, 'workspace', 'user', 'Sample Savings', 1, 'Asset', '', ''),
      (3, 'workspace', 'user', 'Liabilities', NULL, 'Liability', '', ''),
      (4, 'workspace', 'user', 'Sample Card', 3, 'Liability', '', ''),
      (5, 'workspace', 'user', 'Groceries', NULL, 'Expense', '', '');
    INSERT INTO draft_transactions
      (id, workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit,
       account_id, base_account_id, balance_assertion_base_account, created_at, updated_at)
    VALUES
      (11, 'workspace', 'user', '2026-02-03', 'NOPII deposit', 0, 500, NULL, 2, NULL, '', ''),
      (12, 'workspace', 'user', '2026-02-05', 'NOPII groceries', 200, 0, 5, 2, 1300, '', '');
    ${extra}
  `);
  return { db, sqlite, auth: testLedgerAuth() } as Ledger;
}

function account(ledger: Ledger, accountId: number) {
  return loadOpeningBalances(ledger).accounts.find(
    (a) => a.accountId === accountId,
  );
}

function entries(ledger: Ledger, journalId: number) {
  return ledger.sqlite
    .prepare(
      `SELECT account_id, debit, credit, account_balance_assertion AS assertion, comment
       FROM journal_entries WHERE journal_id = ? ORDER BY id`,
    )
    .all(journalId);
}

describe("loadOpeningBalances", () => {
  it("lists assets and liabilities by path, with dates and a suggestion from the drafts", () => {
    const ledger = books();

    expect(loadOpeningBalances(ledger)).toEqual({
      equityAccount: null,
      accounts: [
        {
          accountId: 1,
          name: "Assets",
          path: "Assets",
          accountType: "Asset",
          section: null,
          firstActivityDate: null,
          defaultDate: null,
          impliedOpening: null,
          opening: null,
          removable: false,
          activity: [],
        },
        {
          accountId: 2,
          name: "Sample Savings",
          path: "Assets:Sample Savings",
          accountType: "Asset",
          section: "own",
          firstActivityDate: "2026-02-03",
          defaultDate: "2026-02-02",
          impliedOpening: 1000,
          opening: null,
          removable: false,
          activity: [
            { date: "2026-02-03", amount: 500 },
            { date: "2026-02-05", amount: -200 },
          ],
        },
        {
          accountId: 3,
          name: "Liabilities",
          path: "Liabilities",
          accountType: "Liability",
          section: null,
          firstActivityDate: null,
          defaultDate: null,
          impliedOpening: null,
          opening: null,
          removable: false,
          activity: [],
        },
        {
          accountId: 4,
          name: "Sample Card",
          path: "Liabilities:Sample Card",
          accountType: "Liability",
          section: "owe",
          firstActivityDate: null,
          defaultDate: null,
          impliedOpening: null,
          opening: null,
          removable: true,
          activity: [],
        },
      ],
      unanswered: [
        expect.objectContaining({ accountId: 2 }),
        expect.objectContaining({ accountId: 4 }),
      ],
      wrongSide: [],
    });
  });

  it("dates from the first posted entry, and counts it in what the first check implies", () => {
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (6, 'workspace', 'user', 'Sample Salary', NULL, 'Revenue', '', '');
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES (20, 'workspace', 'user', '2026-01-10', 'Deposits', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
      VALUES
        (201, 'workspace', 'user', 20, 2, 100, 0, '', ''),
        (202, 'workspace', 'user', 20, 6, 0, 100, '', '');
    `);

    expect(account(ledger, 2)).toMatchObject({
      firstActivityDate: "2026-01-10",
      defaultDate: "2026-01-09",
      // 1300 less the 100 posted and the 300 in drafts.
      impliedOpening: 900,
      opening: null,
    });
  });

  it("reads the implied opening from the first posted check, and calls a recorded one that differs manual", () => {
    const ledger = books();
    recorded(ledger, 2, "2026-01-01", 900);
    ledger.sqlite.exec(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (60, 'workspace', 'user', 'Sample Salary', NULL, 'Revenue', '', '');
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES
        (20, 'workspace', 'user', '2026-01-10', 'Deposits', '', ''),
        (21, 'workspace', 'user', '2026-01-11', 'Deposits', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, account_balance_assertion, created_at, updated_at)
      VALUES
        (201, 'workspace', 'user', 20, 2, 100, 0, NULL, '', ''),
        (202, 'workspace', 'user', 20, 60, 0, 100, NULL, '', ''),
        (203, 'workspace', 'user', 21, 2, 200, 0, 1300, '', ''),
        (204, 'workspace', 'user', 21, 60, 0, 200, NULL, '', '');
    `);

    // 1300 less the 300 posted after the opening entry: 1000, not the 900
    // recorded.
    expect(account(ledger, 2)).toMatchObject({
      impliedOpening: 1000,
      opening: expect.objectContaining({ amount: 900, source: "manual" }),
    });
  });

  it("finds opening entries by their Equity line, one journal opening many accounts", () => {
    // The seed's shape: one journal opens both accounts against Equity, with
    // no assertion on the card. A transfer between them touches no Equity.
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (7, 'workspace', 'user', 'Sample Equity', NULL, 'Equity', '', '');
      INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES
        (30, 'workspace', 'user', '2026-01-15', 'Card payment', '', ''),
        (31, 'workspace', 'user', '2026-01-31', 'Opening balances', '', '');
      INSERT INTO journal_entries
        (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit,
         account_balance_assertion, created_at, updated_at)
      VALUES
        (301, 'workspace', 'user', 30, 4, 100, 0, NULL, '', ''),
        (302, 'workspace', 'user', 30, 2, 0, 100, NULL, '', ''),
        (311, 'workspace', 'user', 31, 2, 1000, 0, 1000, '', ''),
        (312, 'workspace', 'user', 31, 4, 0, 2500, NULL, '', ''),
        (313, 'workspace', 'user', 31, 7, 1500, 0, NULL, '', '');
    `);

    // The card payment before it is a posted entry beside it, and the
    // journal is shared, so both are locked; the entry lock is named first.
    expect(account(ledger, 2)?.opening).toEqual({
      account_id: 2,
      journal_id: 31,
      date: "2026-01-31",
      amount: 1000,
      description: "Opening balances",
      standalone: false,
      // Its Equity line is Sample Equity, not Opening Balances.
      onOpeningBalances: false,
      locked: "has_entries",
      source: "manual",
    });
    expect(account(ledger, 4)?.opening).toEqual({
      account_id: 4,
      journal_id: 31,
      date: "2026-01-31",
      amount: -2500,
      description: "Opening balances",
      standalone: false,
      // Its Equity line is Sample Equity, not Opening Balances.
      onOpeningBalances: false,
      locked: "has_entries",
      source: "manual",
    });
    expect(account(ledger, 1)?.opening).toBeNull();
    // Only an Equity account named Opening Balances is the default.
    expect(loadOpeningBalances(ledger).equityAccount).toBeNull();
  });
});

describe("recordOpeningBalance", () => {
  it("posts the entry with its assertion, creating Opening Balances, and the checks pass", () => {
    const ledger = books();
    expect(findFailingChecks(ledger.sqlite, ledger.auth)).toHaveLength(1);

    const outcome = recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
      description: "From the NOPII March statement",
    });

    expect(outcome).toMatchObject({
      kind: "recorded",
      accountName: "Sample Savings",
      equityAccountCreated: true,
      equityAccount: { name: "Opening Balances" },
    });
    if (outcome.kind !== "recorded") throw new Error("not recorded");
    const equityId = outcome.equityAccount.id;
    expect(entries(ledger, outcome.journalId)).toEqual([
      {
        account_id: 2,
        debit: 1000,
        credit: 0,
        assertion: 1000,
        comment: "Opening balance",
      },
      {
        account_id: equityId,
        debit: 0,
        credit: 1000,
        assertion: null,
        comment: "Opening balance",
      },
    ]);
    // No Equity root yet, so Opening Balances is one.
    expect(
      ledger.sqlite
        .prepare("SELECT parent_id, account_type FROM accounts WHERE id = ?")
        .get(equityId),
    ).toEqual({ parent_id: null, account_type: "Equity" });

    expect(findFailingChecks(ledger.sqlite, ledger.auth)).toEqual([]);
    expect(
      lookupLastReconciled(ledger.sqlite, ledger.auth, "Sample Savings"),
    ).toEqual({ date: "2026-02-02", balance: 1000 });
    // The opening entry asserts its own amount, which is no check of the
    // statement's: the drafts' check still implies 1000, so the entry agrees
    // with it. Nothing but the opening entry is posted, so it isn't locked.
    expect(account(ledger, 2)).toMatchObject({
      impliedOpening: 1000,
      opening: {
        journal_id: outcome.journalId,
        date: "2026-02-02",
        amount: 1000,
        description: "From the NOPII March statement",
        standalone: true,
        locked: null,
        source: "statement",
      },
    });
    expect(loadOpeningBalances(ledger).equityAccount).toEqual(
      outcome.equityAccount,
    );
  });

  it("names the journal for the books when the user says nothing", () => {
    const ledger = books();

    const outcome = recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
      description: "   ",
    });

    if (outcome.kind !== "recorded") throw new Error("not recorded");
    expect(account(ledger, 2)?.opening?.description).toBe("Opening balance");
  });

  it("credits money owed, reusing Opening Balances", () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
    });

    const outcome = recordOpeningBalance(ledger, {
      accountId: 4,
      date: "2026-01-31",
      amount: -2500,
    });

    expect(outcome).toMatchObject({
      kind: "recorded",
      equityAccountCreated: false,
    });
    if (outcome.kind !== "recorded") throw new Error("not recorded");
    expect(entries(ledger, outcome.journalId)).toEqual([
      expect.objectContaining({
        account_id: 4,
        debit: 0,
        credit: 2500,
        assertion: -2500,
      }),
      expect.objectContaining({ debit: 2500, credit: 0, assertion: null }),
    ]);
  });

  it("creates Opening Balances under the one Equity root", () => {
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (7, 'workspace', 'user', 'Equity', NULL, 'Equity', '', '');
    `);

    const outcome = recordOpeningBalance(ledger, {
      accountId: 4,
      date: "2026-01-31",
      amount: 0,
    });

    if (outcome.kind !== "recorded") throw new Error("not recorded");
    expect(
      ledger.sqlite
        .prepare("SELECT parent_id FROM accounts WHERE id = ?")
        .get(outcome.equityAccount.id),
    ).toEqual({ parent_id: 7 });
  });

  it("refuses a second opening entry", () => {
    const ledger = books();
    recordOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
    });

    expect(
      recordOpeningBalance(ledger, {
        accountId: 2,
        date: "2026-01-01",
        amount: 2000,
      }),
    ).toMatchObject({
      kind: "already-recorded",
      opening: { date: "2026-02-02", amount: 1000 },
    });
  });

  it("refuses a date on or after the account's first activity, writing nothing", () => {
    const ledger = books();

    expect(
      recordOpeningBalance(ledger, {
        accountId: 2,
        date: "2026-02-03",
        amount: 1000,
      }),
    ).toEqual({
      kind: "date-not-before-first-activity",
      accountName: "Sample Savings",
      firstActivityDate: "2026-02-03",
    });
    expect(
      ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM journals").get(),
    ).toEqual({ n: 0 });
  });

  it("refuses an account that isn't an asset or liability, and one not in the books", () => {
    const ledger = books();

    expect(
      recordOpeningBalance(ledger, {
        accountId: 5,
        date: "2026-01-01",
        amount: 1000,
      }),
    ).toEqual({ kind: "not-asset-or-liability", accountName: "Groceries" });
    expect(
      recordOpeningBalance(ledger, {
        accountId: 99,
        date: "2026-01-01",
        amount: 1000,
      }),
    ).toEqual({ kind: "account-not-found" });
  });

  it("refuses when Opening Balances exists but isn't Equity", () => {
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (7, 'workspace', 'user', 'Opening Balances', NULL, 'Revenue', '', '');
    `);

    expect(
      recordOpeningBalance(ledger, {
        accountId: 4,
        date: "2026-01-01",
        amount: -1000,
      }),
    ).toEqual({ kind: "opening-balances-not-equity" });
  });
});

// Posts a journal of `amount` from Sample Savings to Groceries on `date`.
const SPENT = (date: string, amount = 100) => `
  INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
  VALUES (40, 'workspace', 'user', '${date}', 'NOPII groceries', '', '');
  INSERT INTO journal_entries
    (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
  VALUES
    (401, 'workspace', 'user', 40, 5, ${amount}, 0, '', ''),
    (402, 'workspace', 'user', 40, 2, 0, ${amount}, '', '');
`;

// A journal opening Sample Savings and Sample Card together.
const SHARED_OPENING = `
  INSERT INTO accounts
    (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
  VALUES (7, 'workspace', 'user', 'Opening Balances', NULL, 'Equity', '', '');
  INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
  VALUES (31, 'workspace', 'user', '2026-01-31', 'Opening balances', '', '');
  INSERT INTO journal_entries
    (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit,
     account_balance_assertion, created_at, updated_at)
  VALUES
    (311, 'workspace', 'user', 31, 2, 1000, 0, 1000, '', ''),
    (312, 'workspace', 'user', 31, 4, 0, 2500, -2500, '', ''),
    (313, 'workspace', 'user', 31, 7, 1500, 0, NULL, '', '');
`;

// A draft on Sample Savings's statement, 300 paid to Sample Card on 4
// February: posted, it is on the card too.
const CARD_PAYMENT = `
  INSERT INTO draft_transactions
    (id, workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit,
     account_id, base_account_id, created_at, updated_at)
  VALUES (13, 'workspace', 'user', '2026-02-04', 'NOPII card payment', 300, 0, 4, 2, '', '');
`;

// Everything posted, to show a refusal wrote nothing.
function posted(ledger: Ledger) {
  return {
    journals: ledger.sqlite.prepare("SELECT * FROM journals ORDER BY id").all(),
    entries: ledger.sqlite
      .prepare("SELECT * FROM journal_entries ORDER BY id")
      .all(),
    accounts: ledger.sqlite.prepare("SELECT * FROM accounts ORDER BY id").all(),
  };
}

function recorded(
  ledger: Ledger,
  accountId: number,
  date: string,
  amount: number,
) {
  const outcome = recordOpeningBalance(ledger, { accountId, date, amount });
  if (outcome.kind !== "recorded") throw new Error(outcome.kind);
  return outcome.journalId;
}

describe("the Opening balances page's sections", () => {
  it("puts preset banks and cards with their statements, leaves in own or owe, and hides empty groups", () => {
    // Sample Savings is Sample Bank's; Sample Wallet is a leaf under Sample
    // Cash, a group; Sample Loans is a group with an opening entry.
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES
        (8, 'workspace', 'user', 'Sample Cash', 1, 'Asset', '', ''),
        (9, 'workspace', 'user', 'Sample Wallet', 8, 'Asset', '', ''),
        (10, 'workspace', 'user', 'Sample Loans', 3, 'Liability', '', ''),
        (11, 'workspace', 'user', 'Sample Car Loan', 10, 'Liability', '', '');
      INSERT INTO import_presets
        (workspace_id, scoped_to_user_id, name, parsers, accounts, updated_at)
      VALUES ('workspace', 'user', 'Sample Bank', '[]',
        '[{"account_id":2,"name":"Sample Savings","is_credit_card":false,"account_identifiers":[],"custom_mappings_filenames":[]}]',
        '2026-09-01T00:00:00Z');
    `);
    recorded(ledger, 10, "2026-01-01", -5000);
    recorded(ledger, 9, "2026-01-01", 300);

    expect(
      loadOpeningBalances(ledger).accounts.map((one) => [
        one.name,
        one.section,
      ]),
    ).toEqual([
      ["Assets", null],
      ["Sample Cash", null],
      ["Sample Wallet", "own"],
      ["Sample Savings", "statement"],
      ["Liabilities", null],
      ["Sample Card", "owe"],
      ["Sample Loans", "owe"],
      ["Sample Car Loan", "owe"],
    ]);
  });
});

describe("first activity and the default date", () => {
  it("leaves the opening entry out of the first activity", () => {
    const ledger = books();
    recorded(ledger, 4, "2026-01-31", -2500);

    expect(account(ledger, 4)).toMatchObject({
      firstActivityDate: null,
      opening: { date: "2026-01-31" },
    });
  });

  it("defaults to the day before the first activity, else the day the books start", () => {
    const ledger = books();
    expect(account(ledger, 4)?.defaultDate).toBeNull();

    recorded(ledger, 2, "2026-01-20", 1000);

    expect(account(ledger, 2)?.defaultDate).toBe("2026-02-02");
    expect(account(ledger, 4)?.defaultDate).toBe("2026-01-20");
  });

  it("counts a draft categorized to the account, from another's statement", () => {
    const ledger = books(CARD_PAYMENT);

    expect(account(ledger, 4)).toMatchObject({
      firstActivityDate: "2026-02-04",
      defaultDate: "2026-02-03",
      impliedOpening: null,
    });
  });

  it("counts what is posted before the first check in what it implies", () => {
    const ledger = books(SPENT("2026-02-01"));

    // 1300 less the 100 spent and the 300 in drafts.
    expect(account(ledger, 2)).toMatchObject({
      firstActivityDate: "2026-02-01",
      impliedOpening: 1100,
    });
  });

  it("calls a recorded opening manual when its statements print no balance", () => {
    const ledger = books();
    recorded(ledger, 4, "2026-01-01", -2500);

    expect(account(ledger, 4)).toMatchObject({
      impliedOpening: null,
      opening: expect.objectContaining({ amount: -2500, source: "manual" }),
    });
  });
});

describe("a draft categorized to the account", () => {
  it("refuses an opening on or after it, writing nothing", () => {
    const ledger = books(CARD_PAYMENT);
    const before = posted(ledger);

    expect(
      recordOpeningBalance(ledger, {
        accountId: 4,
        date: "2026-02-10",
        amount: -2500,
      }),
    ).toEqual({
      kind: "date-not-before-first-activity",
      accountName: "Sample Card",
      firstActivityDate: "2026-02-04",
    });
    expect(posted(ledger)).toEqual(before);
  });

  it("refuses to move an opening on or after it, writing nothing", () => {
    const ledger = books(CARD_PAYMENT);
    recorded(ledger, 4, "2026-01-31", -2500);
    const before = posted(ledger);

    expect(
      changeOpeningBalance(ledger, {
        accountId: 4,
        date: "2026-02-10",
        amount: -2500,
      }),
    ).toEqual({
      kind: "date-not-before-first-activity",
      accountName: "Sample Card",
      firstActivityDate: "2026-02-04",
    });
    expect(posted(ledger)).toEqual(before);
    expect(account(ledger, 4)?.opening?.locked).toBeNull();
  });
});

describe("locks", () => {
  it("locks an opening entry with a posted entry beside it", () => {
    const ledger = books(SPENT("2026-02-01"));
    const journalId = recorded(ledger, 2, "2026-01-31", 1000);

    expect(account(ledger, 2)?.opening).toMatchObject({
      journal_id: journalId,
      locked: "has_entries",
    });
  });

  it("leaves it open with only drafts beside it", () => {
    const ledger = books();
    recorded(ledger, 2, "2026-02-02", 1000);

    expect(account(ledger, 2)?.opening?.locked).toBeNull();
  });

  it("locks an opening entry whose journal opens other accounts too", () => {
    const ledger = books(SHARED_OPENING);

    expect(account(ledger, 2)?.opening).toMatchObject({
      journal_id: 31,
      locked: "shared_entry",
    });
    expect(account(ledger, 4)?.opening?.locked).toBe("shared_entry");
  });
});

describe("changeOpeningBalance", () => {
  it("changes the entry in place, and the balance checks then pass", () => {
    const ledger = books();
    const journalId = recorded(ledger, 2, "2026-01-31", 900);
    expect(findFailingChecks(ledger.sqlite, ledger.auth)).toHaveLength(1);

    const outcome = changeOpeningBalance(ledger, {
      accountId: 2,
      date: "2026-02-02",
      amount: 1000,
      description: "  From the NOPII statement  ",
    });

    expect(outcome).toEqual({
      kind: "changed",
      accountName: "Sample Savings",
      journalId,
    });
    expect(entries(ledger, journalId)).toEqual([
      expect.objectContaining({
        account_id: 2,
        debit: 1000,
        credit: 0,
        assertion: 1000,
      }),
      expect.objectContaining({ debit: 0, credit: 1000, assertion: null }),
    ]);
    expect(account(ledger, 2)?.opening).toMatchObject({
      journal_id: journalId,
      date: "2026-02-02",
      amount: 1000,
      description: "From the NOPII statement",
      locked: null,
    });
    expect(findFailingChecks(ledger.sqlite, ledger.auth)).toEqual([]);
  });

  it("names the journal for the books when the user says nothing", () => {
    const ledger = books();
    recorded(ledger, 4, "2026-01-31", -2500);

    changeOpeningBalance(ledger, {
      accountId: 4,
      date: "2026-01-30",
      amount: 500,
      description: " ",
    });

    expect(account(ledger, 4)?.opening).toMatchObject({
      amount: 500,
      description: "Opening balance",
    });
  });

  it("refuses, writing nothing", () => {
    const ledger = books(SPENT("2026-02-10"));
    recorded(ledger, 2, "2026-01-31", 1000);
    const locked = books(SHARED_OPENING);
    const open = books();
    recorded(open, 2, "2026-01-31", 1000);
    const change = (on: Ledger, accountId: number, date = "2026-01-01") => {
      const before = posted(on);
      const outcome = changeOpeningBalance(on, { accountId, date, amount: 5 });
      expect(posted(on)).toEqual(before);
      return outcome;
    };

    expect(change(ledger, 99)).toEqual({ kind: "account-not-found" });
    expect(change(ledger, 5)).toEqual({
      kind: "not-asset-or-liability",
      accountName: "Groceries",
    });
    expect(change(ledger, 4)).toEqual({
      kind: "not-recorded",
      accountName: "Sample Card",
    });
    expect(change(ledger, 2)).toEqual({
      kind: "locked",
      accountName: "Sample Savings",
      lock: "has_entries",
      journalId: expect.any(Number),
    });
    expect(change(locked, 4)).toEqual({
      kind: "locked",
      accountName: "Sample Card",
      lock: "shared_entry",
      journalId: 31,
    });
    expect(change(open, 2, "2026-02-03")).toEqual({
      kind: "date-not-before-first-activity",
      accountName: "Sample Savings",
      firstActivityDate: "2026-02-03",
    });
  });
});

describe("removeOpeningBalance", () => {
  it("deletes the entry and keeps Opening Balances", () => {
    const ledger = books();
    const journalId = recorded(ledger, 2, "2026-02-02", 1000);

    expect(removeOpeningBalance(ledger, 2)).toEqual({
      kind: "removed",
      accountName: "Sample Savings",
      journalId,
    });
    expect(account(ledger, 2)?.opening).toBeNull();
    expect(
      ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM journals").get(),
    ).toEqual({ n: 0 });
    expect(loadOpeningBalances(ledger).equityAccount).toMatchObject({
      name: "Opening Balances",
    });
  });

  it("refuses a locked entry and an account without one, writing nothing", () => {
    const ledger = books(SPENT("2026-02-10"));
    recorded(ledger, 2, "2026-01-31", 1000);
    const shared = books(SHARED_OPENING);
    const remove = (on: Ledger, accountId: number) => {
      const before = posted(on);
      const outcome = removeOpeningBalance(on, accountId);
      expect(posted(on)).toEqual(before);
      return outcome;
    };

    expect(remove(ledger, 2)).toMatchObject({
      kind: "locked",
      lock: "has_entries",
    });
    expect(remove(shared, 2)).toMatchObject({
      kind: "locked",
      lock: "shared_entry",
      journalId: 31,
    });
    expect(remove(ledger, 4)).toEqual({
      kind: "not-recorded",
      accountName: "Sample Card",
    });
    expect(remove(ledger, 5)).toEqual({
      kind: "not-asset-or-liability",
      accountName: "Groceries",
    });
    expect(remove(ledger, 99)).toEqual({ kind: "account-not-found" });
  });
});

describe("the accounts whose start is unanswered", () => {
  const names = (ledger: Ledger) =>
    loadOpeningBalances(ledger).unanswered.map((one) => one.name);

  it("lists every leaf asset or liability with no opening entry, touched or not", () => {
    // Sample Gold has nothing on it; Sample Loans is a group with a loan
    // under it; Loans and Credit Cards are the empty groups banks, cards
    // and loans are added under.
    const ledger = books(`
      INSERT INTO accounts
        (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES
        (8, 'workspace', 'user', 'Sample Gold', 1, 'Asset', '', ''),
        (10, 'workspace', 'user', 'Sample Loans', 3, 'Liability', '', ''),
        (11, 'workspace', 'user', 'Sample Car Loan', 10, 'Liability', '', ''),
        (12, 'workspace', 'user', 'Loans', 3, 'Liability', '', ''),
        (13, 'workspace', 'user', 'Credit Cards', 3, 'Liability', '', '');
    `);

    expect(names(ledger)).toEqual([
      "Sample Gold",
      "Sample Savings",
      "Sample Card",
      "Sample Car Loan",
    ]);
  });

  it("drops an account once its opening is recorded, an opening of 0 included", () => {
    const ledger = books();
    recorded(ledger, 2, "2026-02-02", 1000);
    expect(names(ledger)).toEqual(["Sample Card"]);

    recorded(ledger, 4, "2026-01-31", 0);
    expect(names(ledger)).toEqual([]);
  });

  it("offers removal only while nothing touches the account", () => {
    const ledger = books(CARD_PAYMENT);
    expect(account(ledger, 4)?.removable).toBe(false);
    expect(account(books(), 4)?.removable).toBe(true);
    // A statement's own account, and a group, never.
    expect(account(books(), 2)?.removable).toBe(false);
    expect(account(books(), 1)?.removable).toBe(false);

    const opened = books();
    recorded(opened, 4, "2026-01-31", -2500);
    expect(account(opened, 4)?.removable).toBe(false);
  });
});

describe("balances on the wrong side", () => {
  it("lists a liability in debit and an asset in credit, drafts included", () => {
    // Sample Card is paid 300 from Sample Savings with nothing owed on it.
    const ledger = books(CARD_PAYMENT);

    // Sample Savings comes to 0: 500 in, 200 and 300 out.
    expect(loadOpeningBalances(ledger).wrongSide).toEqual([
      { account: expect.objectContaining({ accountId: 4 }), balance: 300 },
    ]);
  });

  it("leaves a liability whose opening covers its repayments off", () => {
    const ledger = books(CARD_PAYMENT);
    recorded(ledger, 4, "2026-02-03", -1000);

    expect(loadOpeningBalances(ledger).wrongSide).toEqual([]);
  });

  it("lists an asset paid out of with nothing put in", () => {
    const ledger = books(SPENT("2026-02-01", 2000));

    expect(loadOpeningBalances(ledger).wrongSide).toEqual([
      // -2000 posted, then 500 in and 200 out in drafts.
      { account: expect.objectContaining({ accountId: 2 }), balance: -1700 },
    ]);
  });
});

describe("an opening of 0: the account started here", () => {
  it("posts a 0 entry with a 0 assertion against Opening Balances, and its checks pass", () => {
    // A loan paid out on 4 February, the card payment standing in for it:
    // nothing was owed the day before.
    const ledger = books(CARD_PAYMENT);
    const journalId = recorded(ledger, 4, "2026-02-03", 0);

    expect(entries(ledger, journalId)).toEqual([
      {
        account_id: 4,
        debit: 0,
        credit: 0,
        assertion: 0,
        comment: "Opening balance",
      },
      {
        account_id: expect.any(Number),
        debit: 0,
        credit: 0,
        assertion: null,
        comment: "Opening balance",
      },
    ]);
    expect(account(ledger, 4)?.opening).toMatchObject({
      journal_id: journalId,
      date: "2026-02-03",
      amount: 0,
      locked: null,
    });
    expect(
      findFailingChecks(ledger.sqlite, ledger.auth).filter(
        (check) => check.account_id === 4,
      ),
    ).toEqual([]);
    expect(
      countPostedAssertionFailures(ledger.sqlite, ledger.auth).get(4),
    ).toBeUndefined();
  });

  it("refuses to post an older statement that disagrees with it, though its own drafts pass", () => {
    // Sample Card started here on 31 January, then its statement for
    // earlier in January comes in: 500 spent on 10 January, owing 500.
    const ledger = books();
    recorded(ledger, 4, "2026-01-31", 0);
    ledger.sqlite.exec(`
      INSERT INTO draft_transactions
        (id, workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit,
         account_id, base_account_id, balance_assertion_base_account, created_at, updated_at)
      VALUES (21, 'workspace', 'user', '2026-01-10', 'NOPII groceries', 500, 0, 5, 4, -500, '', '');
      UPDATE draft_transactions SET created_at = '2026-03-01T00:00:00Z', updated_at = '2026-03-01T00:00:00Z';
      UPDATE accounts SET created_at = '2026-03-01T00:00:00Z', updated_at = '2026-03-01T00:00:00Z';
    `);

    // The draft-side check reads the statement against itself, and passes.
    expect(
      findFailingChecks(ledger.sqlite, ledger.auth).filter(
        (check) => check.account_id === 4,
      ),
    ).toEqual([]);
    // Posting would leave the opening's 0 assertion failing, so it is
    // refused and nothing is written.
    const outcome = postPress(
      ledger,
      [4],
      new Map([
        [2, "Sample Savings"],
        [4, "Sample Card"],
        [5, "Groceries"],
      ]),
    );
    expect(outcome).toMatchObject({
      kind: "breaks-posted-checks",
      broken: [{ accountId: 4, name: "Sample Card", failures: 1 }],
    });
  });
});
