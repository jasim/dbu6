import { describe, expect, it } from "vitest";
import type {
  AddAccountCandidate,
  AddAccountFile,
  AddAccountReading,
  StatementImportError,
} from "../../shared/index";
import {
  addCard,
  addHref,
  addMonths,
  carriedFrom,
  defaultMonth,
  monthChoices,
  readAddUrl,
  type AddUrl,
  type Held,
} from "./state";

/*
 * /add's card is a pure function of the URL, the held files, the read of
 * them and the answers given (PLAN.md "The cards"). Each condition is its
 * own card, only when it applies, in one precedence order.
 */

const url = (search: string): AddUrl => readAddUrl(new URLSearchParams(search));

// Nothing dropped yet.
const NOTHING_HELD: Held = {
  files: 0,
  reading: null,
  addMore: false,
  kind: null,
  opening: null,
};

const FROM_JAN = url("?from=2025-01");
const LATEST = url("?from=latest");
const SETUP_FROM_JAN = url("?run=setup&from=2025-01");

const CATEGORIZER = { ready: true as const, name: "Sample Agent" };

function candidate(
  overrides: Partial<AddAccountCandidate> = {},
): AddAccountCandidate {
  return {
    key: "account:new:bank:050505000012",
    status: "new",
    account: null,
    institution: "Sample Bank",
    institution_listed: true,
    kind: "bank",
    identifier: "050505000012",
    parsers: ["sample-bank-xls"],
    file_names: ["jan.xls", "feb.xls"],
    period: { first_date: "2025-01-01", last_date: "2025-02-28" },
    transactions: 40,
    opening: { date: "2024-12-31", amount: 10000 },
    needs_opening: false,
    opening_refusal: null,
    refusal: null,
    ...overrides,
  };
}

function readFile(
  file_name: string,
  first_date: string,
  last_date: string,
  account_key = "account:new:bank:050505000012",
): AddAccountFile {
  return {
    status: "read",
    file_name,
    account_key,
    parser: "sample-bank-xls",
    period: { first_date, last_date },
    transactions: 20,
    saved_path: null,
  };
}

const JAN = readFile("jan.xls", "2025-01-01", "2025-01-31");
const FEB = readFile("feb.xls", "2025-02-01", "2025-02-28");

const UNRECOGNIZED: AddAccountFile = {
  status: "unrecognized",
  file_name: "sample.pdf",
  saved_path: "tmp/statement-uploads/050505/sample.pdf",
  candidate_parser_paths: ["sample-bank-pdf"],
};

const AMBIGUOUS: AddAccountFile = {
  status: "ambiguous",
  file_name: "sample.csv",
  saved_path: "tmp/statement-uploads/050505/sample.csv",
  matching_parser_paths: ["sample-bank-csv", "other-bank-csv"],
};

function reading(
  accounts: AddAccountCandidate[],
  files: AddAccountFile[] = [JAN, FEB],
): AddAccountReading {
  return { files, accounts, categorizer: CATEGORIZER };
}

/** What the browser holds once `read` came back. */
function held(read: AddAccountReading, overrides: Partial<Held> = {}): Held {
  return {
    ...NOTHING_HELD,
    files: read.files.length,
    reading: { state: "read", reading: read },
    ...overrides,
  };
}

const GAP: StatementImportError = {
  error: "statement_boundary_mismatch",
  message: "Statements don't meet.",
  reason: "gap",
  earlier_source: "feb.xls",
  later_source: "apr.xls",
  earlier_closing: 10000,
  later_opening: 12000,
  difference: 2000,
};

describe("the URL", () => {
  it("reads ?from, ?run=setup and ?added", () => {
    expect(url("")).toEqual({ from: null, setup: false, added: null });
    expect(url("?from=latest")).toEqual({
      from: { kind: "latest" },
      setup: false,
      added: null,
    });
    expect(url("?run=setup&from=2025-01&added=12")).toEqual({
      from: { kind: "month", month: "2025-01" },
      setup: true,
      added: 12,
    });
  });

  it("takes anything else as unanswered", () => {
    for (const bad of ["2025-13", "2025-1", "jan", "2025-01-01", ""]) {
      expect(url(`?from=${bad}`).from).toBeNull();
    }
    expect(url("?run=other").setup).toBe(false);
    for (const bad of ["0", "-1", "x", "1.5", ""]) {
      expect(url(`?added=${bad}`).added).toBeNull();
    }
  });

  it("writes the same state back", () => {
    expect(addHref({})).toBe("/add");
    expect(addHref(SETUP_FROM_JAN)).toBe("/add?run=setup&from=2025-01");
    expect(addHref({ ...SETUP_FROM_JAN, added: 12 })).toBe(
      "/add?run=setup&from=2025-01&added=12",
    );
    expect(addHref({ from: { kind: "latest" } })).toBe("/add?from=latest");
  });

  it("reads card 2's carried answer from the navigation state", () => {
    expect(carriedFrom({ from: { kind: "month", month: "2025-03" } })).toEqual({
      kind: "month",
      month: "2025-03",
    });
    expect(carriedFrom({ from: { kind: "latest" } })).toEqual({
      kind: "latest",
    });
    expect(carriedFrom({ from: null })).toBeNull();
    expect(carriedFrom({ from: { kind: "month", month: "March" } })).toBeNull();
    expect(carriedFrom(null)).toBeNull();
    expect(carriedFrom("2025-03")).toBeNull();
  });
});

describe("card 2's months", () => {
  it("counts back from this month, across years", () => {
    expect(addMonths("2025-01", -1)).toBe("2024-12");
    expect(addMonths("2024-12", 3)).toBe("2025-03");
    expect(monthChoices("2026-09-25", 3)).toEqual([
      "2026-09",
      "2026-08",
      "2026-07",
    ]);
    expect(monthChoices("2026-09-25")).toHaveLength(48);
    expect(defaultMonth("2026-09-25")).toBe("2026-01");
  });
});

describe("which card shows", () => {
  it("asks how far back until ?from is answered", () => {
    expect(addCard(url(""), NOTHING_HELD)).toEqual({ card: "how-far-back" });
    expect(addCard(url("?run=setup"), NOTHING_HELD)).toEqual({
      card: "how-far-back",
    });
    // Files held from before don't skip the question.
    expect(addCard(url(""), held(reading([candidate()])))).toEqual({
      card: "how-far-back",
    });
  });

  it("asks for the files once ?from is answered", () => {
    expect(addCard(FROM_JAN, NOTHING_HELD)).toEqual({ card: "drop" });
    expect(addCard(LATEST, NOTHING_HELD)).toEqual({ card: "drop" });
  });

  it("goes back to Drop when the user adds to the set", () => {
    const read = reading([candidate()]);
    expect(addCard(FROM_JAN, held(read, { addMore: true }))).toEqual({
      card: "drop",
    });
  });

  it("waits while the files are read, and says when the read failed", () => {
    const base = { ...NOTHING_HELD, files: 2 };
    expect(
      addCard(FROM_JAN, { ...base, reading: { state: "reading" } }),
    ).toEqual({ card: "reading" });
    expect(
      addCard(FROM_JAN, {
        ...base,
        reading: { state: "failed", message: "Sample failure." },
      }),
    ).toEqual({ card: "read-failed", message: "Sample failure." });
  });

  it("confirms statements that read cleanly, their balances as a fact", () => {
    const account = candidate();
    expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
      card: "confirm",
      account,
      kind: "bank",
      opening: { from: "statements", date: "2024-12-31", amount: 10000 },
      categorizer: CATEGORIZER,
    });
  });

  it("confirms a bank or card set up with no transactions yet", () => {
    const account = candidate({
      status: "empty",
      account: { id: 4, name: "Sample Joint" },
    });
    expect(addCard(FROM_JAN, held(reading([account]))).card).toBe("confirm");
  });

  it("starts from the books' opening when the statements print none", () => {
    const account = candidate({
      status: "empty",
      account: { id: 4, name: "Sample Joint" },
      opening: { date: "2024-12-31", amount: null },
      needs_opening: false,
    });
    expect(addCard(FROM_JAN, held(reading([account])))).toMatchObject({
      card: "confirm",
      opening: { from: "books" },
    });
  });

  it("hands a file no parser reads, or several do, to the coding agent", () => {
    expect(addCard(FROM_JAN, held(reading([], [UNRECOGNIZED])))).toEqual({
      card: "teach",
      files: [UNRECOGNIZED],
      at: [0],
      readable: 0,
    });
    expect(addCard(FROM_JAN, held(reading([], [AMBIGUOUS])))).toEqual({
      card: "teach",
      files: [AMBIGUOUS],
      at: [0],
      readable: 0,
    });
    // Beside files that did read, which could be left out.
    expect(
      addCard(
        FROM_JAN,
        held(reading([candidate()], [JAN, AMBIGUOUS, UNRECOGNIZED, FEB])),
      ),
    ).toEqual({
      card: "teach",
      files: [AMBIGUOUS, UNRECOGNIZED],
      // By their place in the drop, which "Leave them out" drops.
      at: [1, 2],
      readable: 2,
    });
  });

  it("takes one account per drop", () => {
    const savings = candidate();
    const card = candidate({
      key: "account:new:card:050505XXXXXX0505",
      institution: "Sample Card Co",
      kind: "card",
      identifier: "050505XXXXXX0505",
      file_names: ["card.pdf"],
    });
    // The card's statement was dropped between the savings ones, under the
    // same name as one of them: the first account's files are found by
    // their place in the drop.
    const cardFile = readFile("jan.xls", "2025-01-01", "2025-01-31", card.key);
    expect(
      addCard(FROM_JAN, held(reading([savings, card], [JAN, cardFile, FEB]))),
    ).toEqual({
      card: "several",
      accounts: [savings, card],
      firstAt: [0, 2],
    });
    // Unreadable files come first: they may be a third account's.
    expect(
      addCard(FROM_JAN, held(reading([savings, card], [JAN, UNRECOGNIZED])))
        .card,
    ).toBe("teach");
  });

  it("sends an account with transactions to Import", () => {
    const account = candidate({
      status: "in_books",
      account: { id: 4, name: "Sample Joint" },
      // Its own refusal doesn't matter: Import says it.
      refusal: GAP,
    });
    expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
      card: "in-books",
      account,
    });
  });

  it("says when the statements hold no rows", () => {
    for (const account of [
      candidate({ period: null, opening: null, transactions: 0 }),
      candidate({ transactions: 0 }),
    ]) {
      expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
        card: "no-transactions",
        account,
      });
    }
  });

  it("names a gap between two files, and the files before it", () => {
    const account = candidate({
      file_names: ["jan.xls", "feb.xls", "apr.xls", "may.xls"],
      refusal: GAP,
    });
    // Dropped in any order: the files before the gap are named by their
    // place in the drop.
    const files = [
      readFile("apr.xls", "2025-04-01", "2025-04-30"),
      JAN,
      readFile("may.xls", "2025-05-01", "2025-05-31"),
      FEB,
    ];
    expect(addCard(FROM_JAN, held(reading([account], files)))).toEqual({
      card: "gap",
      account,
      gap: { endsIn: "2025-02", resumesIn: "2025-04", before: [1, 3] },
    });
  });

  it("shows any other refusal in the import's words", () => {
    const twice: StatementImportError = {
      ...GAP,
      reason: "same-statement-twice",
    };
    const unjoinable: StatementImportError = {
      error: "statement_part_unjoinable",
      message: "Sample part has no balances.",
      part: "feb.xls",
    };
    for (const refusal of [twice, unjoinable]) {
      const account = candidate({ refusal });
      expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
        card: "refused",
        account,
        refusal,
        // The same statement twice gets /import's prompt; a part with no
        // balances is the user's to fix.
        promptsAgent: refusal === twice,
      });
    }
    // A gap whose files the read has no dates for is shown as it is.
    const account = candidate({ refusal: GAP });
    expect(addCard(FROM_JAN, held(reading([account], [JAN]))).card).toBe(
      "refused",
    );
  });

  it("says when the account's opening entry refuses the statements", () => {
    const account = candidate({
      status: "empty",
      account: { id: 4, name: "Sample Joint" },
      opening_refusal: {
        code: "opening_disagrees",
        error: "Sample Joint opens at another balance on 31 Dec 2024.",
      },
    });
    expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
      card: "opening-refused",
      account,
      error: "Sample Joint opens at another balance on 31 Dec 2024.",
    });
    // After the import's own refusal, before the questions.
    expect(
      addCard(FROM_JAN, held(reading([{ ...account, refusal: GAP }], [JAN])))
        .card,
    ).toBe("refused");
    const cleared = { ...account, kind: null, opening_refusal: null };
    expect(addCard(FROM_JAN, held(reading([cleared]))).card).toBe("kind");
  });

  it("says when the statements start later than ?from's month", () => {
    const account = candidate({
      period: { first_date: "2025-03-05", last_date: "2025-08-31" },
    });
    expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
      card: "late-start",
      account,
      from: "2025-01",
      starts: "2025-03",
    });
    // Starting within the month isn't late; nor is anything for "latest".
    expect(addCard(url("?from=2025-03"), held(reading([account]))).card).toBe(
      "confirm",
    );
    expect(addCard(LATEST, held(reading([account]))).card).toBe("confirm");
    // Starting earlier than asked is fine: the files decide.
    expect(addCard(url("?from=2025-06"), held(reading([account]))).card).toBe(
      "confirm",
    );
  });

  it("asks bank or card when the statements print no account number", () => {
    const account = candidate({ kind: null, identifier: null });
    expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
      card: "kind",
      account,
    });
    expect(
      addCard(FROM_JAN, held(reading([account]), { kind: "card" })),
    ).toMatchObject({ card: "confirm", kind: "card" });
  });

  it("asks for the opening only when the add needs one", () => {
    const account = candidate({
      opening: { date: "2024-12-31", amount: null },
      needs_opening: true,
    });
    expect(addCard(FROM_JAN, held(reading([account])))).toEqual({
      card: "balance",
      account,
      kind: "bank",
      date: "2024-12-31",
    });
    expect(
      addCard(FROM_JAN, held(reading([account]), { opening: -5000 })),
    ).toMatchObject({
      card: "confirm",
      opening: { from: "typed", date: "2024-12-31", amount: -5000 },
    });
  });

  it("asks for the balance, not the refusal, when a new account has none", () => {
    const account = candidate({
      opening: { date: "2024-12-31", amount: null },
      needs_opening: true,
      refusal: {
        error: "opening_balance_unavailable",
        message: "No opening balance.",
      },
    });
    expect(addCard(FROM_JAN, held(reading([account]))).card).toBe("balance");
  });

  it("shows Another? from ?added on the first run only", () => {
    expect(
      addCard(url("?run=setup&from=2025-01&added=12"), NOTHING_HELD),
    ).toEqual({ card: "another", accountId: 12 });
    // A later add hands off to the account's drafts instead: no card here.
    expect(addCard(url("?from=2025-01&added=12"), NOTHING_HELD)).toEqual({
      card: "drop",
    });
  });
});

describe("the precedence between the conditions", () => {
  // Every condition at once, then each removed in turn: the card is always
  // the first one that still applies.
  const everything = candidate({
    kind: null,
    identifier: null,
    period: { first_date: "2025-03-01", last_date: "2025-08-31" },
    opening: { date: "2025-02-28", amount: null },
    needs_opening: true,
    refusal: GAP,
    file_names: ["mar.xls", "apr.xls", "jun.xls"],
  });
  const files = [
    readFile("mar.xls", "2025-03-01", "2025-03-31"),
    readFile("apr.xls", "2025-04-01", "2025-04-30"),
    readFile("jun.xls", "2025-06-01", "2025-08-31"),
  ];
  const gapAfterApr: StatementImportError = {
    ...GAP,
    earlier_source: "apr.xls",
    later_source: "jun.xls",
  };
  const cardOf = (
    account: AddAccountCandidate,
    fileList: AddAccountFile[] = files,
    from: AddUrl = FROM_JAN,
    overrides: Partial<Held> = {},
  ) => addCard(from, held(reading([account], fileList), overrides)).card;

  it("goes ?added, how far back, Teach, one at a time, then the account's", () => {
    expect(
      addCard(
        url("?run=setup&added=12"),
        held(reading([everything], [UNRECOGNIZED])),
      ).card,
    ).toBe("another");
    expect(cardOf(everything, [UNRECOGNIZED, ...files])).toBe("teach");
    expect(
      addCard(
        FROM_JAN,
        held(reading([everything, candidate({ key: "other" })], files)),
      ).card,
    ).toBe("several");
  });

  it("goes in books, no rows, gap, refusal, late start, kind, balance", () => {
    expect(
      cardOf({
        ...everything,
        status: "in_books",
        account: { id: 4, name: "Sample Joint" },
      }),
    ).toBe("in-books");
    expect(cardOf({ ...everything, transactions: 0 })).toBe("no-transactions");
    expect(cardOf({ ...everything, refusal: gapAfterApr })).toBe("gap");
    expect(
      cardOf({
        ...everything,
        refusal: { ...GAP, reason: "same-statement-twice" },
      }),
    ).toBe("refused");
    const clean = { ...everything, refusal: null };
    expect(cardOf(clean)).toBe("late-start");
    // "Start from Mar" rewrote ?from.
    const fromMar = url("?from=2025-03");
    expect(cardOf(clean, files, fromMar)).toBe("kind");
    expect(cardOf(clean, files, fromMar, { kind: "bank" })).toBe("balance");
    expect(
      cardOf(clean, files, fromMar, { kind: "bank", opening: 10000 }),
    ).toBe("confirm");
  });
});
