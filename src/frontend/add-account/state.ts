import {
  promptedFiles,
  readsNoTransactions,
  type AccountKind,
  type AddAccountCandidate,
  type AddAccountFile,
  type AddAccountReading,
  type LlmStatus,
  type StatementImportError,
} from "../../shared/index";

/*
 * Which card /add shows (PLAN.md "The cards"), as a pure function of the URL,
 * the files the browser holds, the read of them, and the answers given
 * since. No flow state is kept anywhere else: leaving and coming back starts
 * from the URL, and Home resumes from the books.
 *
 * In precedence order:
 *
 *   ?added (first run)             → Another?
 *   no ?from                       → How far back
 *   no files, or "add more"        → Drop
 *   a read in flight, or failed    → Reading / the failure
 *   a file no parser reads, or     → Teach dbu6
 *     several parsers read
 *   files of 2+ accounts           → One account at a time
 *   then, for the one account:
 *     already has transactions     → Already in your books
 *     no rows at all               → No transactions
 *     a gap between two files      → Gap
 *     any other refusal            → the import's own words
 *     the account's opening entry  → its words, back to Drop
 *       refuses these statements
 *     starts after ?from's month   → Late start
 *     prints no account number     → Bank or card?
 *     prints no balance, and the   → What did it hold / owe
 *       account has no opening
 *   otherwise                      → Confirm
 *
 * Every refusal comes before the questions, since answering them couldn't
 * get past it. The read checks a statement that prints no account number as
 * a bank's, before the user says which it is, so a refusal only a card's
 * statements get (no closing balance) shows under Confirm's button, from
 * the add. A later add hands off to the account's drafts as soon as it is
 * added, so it has no card here.
 */

// --- The URL ----------------------------------------------------------------

export const ADD_ROUTE = "/add";
export const ADD_OTHER_ROUTE = "/add/other";

/** Card 2's answer: the latest statement only, or from a month on. */
export type From = { kind: "latest" } | { kind: "month"; month: string };

export interface AddUrl {
  /** Null until card 2 is answered. */
  from: From | null;
  /** `?run=setup`: the first run, from Home's "Add your first bank or card". */
  setup: boolean;
  /** `?added=<id>`: the account the first run just added, for card 5. */
  added: number | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function readAddUrl(params: URLSearchParams): AddUrl {
  const raw = params.get("from");
  const from: From | null =
    raw === "latest"
      ? { kind: "latest" }
      : raw !== null && MONTH.test(raw)
        ? { kind: "month", month: raw }
        : null;
  const added = params.get("added");
  return {
    from,
    setup: params.get("run") === "setup",
    added: added !== null && /^[1-9]\d*$/.test(added) ? Number(added) : null,
  };
}

function query(url: Partial<AddUrl>): string {
  const params = new URLSearchParams();
  if (url.setup) params.set("run", "setup");
  if (url.from) {
    params.set("from", url.from.kind === "latest" ? "latest" : url.from.month);
  }
  if (url.added != null) params.set("added", String(url.added));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** /add in the state `url` names. */
export function addHref(url: Partial<AddUrl>): string {
  return `${ADD_ROUTE}${query(url)}`;
}

/**
 * The answer card 2 had for the account before, which "Add another" carries
 * in the router's navigation state for card 2 to preselect.
 */
export function carriedFrom(state: unknown): From | null {
  if (!state || typeof state !== "object" || !("from" in state)) return null;
  const { from } = state;
  if (!from || typeof from !== "object" || !("kind" in from)) return null;
  if (from.kind === "latest") return { kind: "latest" };
  return from.kind === "month" &&
    "month" in from &&
    typeof from.month === "string" &&
    MONTH.test(from.month)
    ? { kind: "month", month: from.month }
    : null;
}

// --- Months -----------------------------------------------------------------

/** "2025-03" from "2025-03-14". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The month `n` months after `month` (before, when negative). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Card 2's months, this one first, `count` in all. */
export function monthChoices(today: string, count = 48): string[] {
  const now = monthOf(today);
  return Array.from({ length: count }, (_, i) => addMonths(now, -i));
}

/** Card 2's month before the user picks one: January this year. */
export function defaultMonth(today: string): string {
  return `${today.slice(0, 4)}-01`;
}

// --- What the browser holds -------------------------------------------------

/** The read of the held files: in flight, failed, or its reply. */
export type Reading =
  | { state: "reading" }
  | { state: "failed"; message: string }
  | { state: "read"; reading: AddAccountReading };

export interface Held {
  /** How many files the set holds. */
  files: number;
  /** Null until the set is first read. */
  reading: Reading | null;
  /** The user asked to add files to the set. */
  addMore: boolean;
  /** The answer to "Bank or card?". */
  kind: AccountKind | null;
  /** The answer to "What did it hold?", ledger sign. */
  opening: number | null;
}

// --- The cards ---------------------------------------------------------------

export type Unreadable = Extract<
  AddAccountFile,
  { status: "unrecognized" | "ambiguous" }
>;

/*
 * The read lists the files in the order they were dropped, so a held file
 * is the read's file at the same position. The cards name the files they
 * leave out or keep by that position, never by name: two drops can share a
 * name.
 */

/** The files either side of a gap, and what "Start from" leaves out. */
export interface Gap {
  /** The month the earlier file ends in. */
  endsIn: string;
  /** The month the later file starts in, which "Start from" starts at. */
  resumesIn: string;
  /** The positions of the files up to the gap, which "Start from" drops. */
  before: number[];
}

/** Where the account's opening balance comes from, as Confirm says it. */
export type Opening =
  | { from: "statements"; date: string; amount: number }
  | { from: "typed"; date: string; amount: number }
  // The statements print none, and the account's opening entry stands.
  | { from: "books" };

export type AddCard =
  | { card: "another"; accountId: number }
  | { card: "how-far-back" }
  | { card: "drop" }
  | { card: "reading" }
  | { card: "read-failed"; message: string }
  | {
      card: "teach";
      files: Unreadable[];
      /** Their positions, which "Leave it out" drops. */
      at: number[];
      readable: number;
    }
  | {
      card: "several";
      accounts: AddAccountCandidate[];
      /** The positions of the first account's files, to start with. */
      firstAt: number[];
    }
  | { card: "in-books"; account: AddAccountCandidate }
  | { card: "no-transactions"; account: AddAccountCandidate }
  | { card: "gap"; account: AddAccountCandidate; gap: Gap }
  | {
      card: "refused";
      account: AddAccountCandidate;
      refusal: StatementImportError;
      /** Its files are kept for a coding-agent prompt (`promptedFiles`). */
      promptsAgent: boolean;
    }
  | { card: "opening-refused"; account: AddAccountCandidate; error: string }
  | {
      card: "late-start";
      account: AddAccountCandidate;
      from: string;
      starts: string;
    }
  | { card: "kind"; account: AddAccountCandidate }
  | {
      card: "balance";
      account: AddAccountCandidate;
      kind: AccountKind;
      date: string;
    }
  | {
      card: "confirm";
      account: AddAccountCandidate;
      kind: AccountKind;
      opening: Opening;
      categorizer: LlmStatus;
    };

export function addCard(url: AddUrl, held: Held): AddCard {
  if (url.setup && url.added !== null) {
    return { card: "another", accountId: url.added };
  }
  if (url.from === null) return { card: "how-far-back" };
  if (held.files === 0 || held.addMore || held.reading === null) {
    return { card: "drop" };
  }
  const { reading } = held;
  switch (reading.state) {
    case "reading":
      return { card: "reading" };
    case "failed":
      return { card: "read-failed", message: reading.message };
    case "read":
      return readCard(url.from, held, reading.reading);
  }
}

function readCard(from: From, held: Held, reading: AddAccountReading): AddCard {
  const { files, accounts, categorizer } = reading;
  // The files a coding-agent prompt points at, as the read kept them.
  const prompted = promptedFiles(reading);
  const unreadable = files.filter(
    (file): file is Unreadable => file.status !== "read",
  );
  if (unreadable.length > 0) {
    return {
      card: "teach",
      files: unreadable,
      at: prompted!,
      readable: files.length - unreadable.length,
    };
  }
  if (accounts.length > 1) {
    const [first] = accounts;
    return {
      card: "several",
      accounts,
      firstAt: positions(
        files,
        (file) => file.status === "read" && file.account_key === first.key,
      ),
    };
  }
  const [account] = accounts;
  if (account === undefined) return { card: "drop" };
  return accountCard(from, held, files, account, categorizer, prompted);
}

function accountCard(
  from: From,
  held: Held,
  files: readonly AddAccountFile[],
  account: AddAccountCandidate,
  categorizer: LlmStatus,
  prompted: number[] | null,
): AddCard {
  if (account.status === "in_books") return { card: "in-books", account };
  const { period, opening } = account;
  // The two nulls again only narrow the types below.
  if (readsNoTransactions(account) || period === null || opening === null) {
    return { card: "no-transactions", account };
  }

  const { refusal } = account;
  // A missing opening is the balance card's to ask, however the read words
  // it.
  if (
    refusal !== null &&
    !(refusal.error === "opening_balance_unavailable" && account.needs_opening)
  ) {
    const gap = gapOf(account, files, refusal);
    return gap
      ? { card: "gap", account, gap }
      : { card: "refused", account, refusal, promptsAgent: prompted !== null };
  }

  // The account's own opening entry stands in the way (it starts on or
  // after these statements, or disagrees with them).
  if (account.opening_refusal !== null) {
    return {
      card: "opening-refused",
      account,
      error: account.opening_refusal.error,
    };
  }

  const starts = monthOf(period.first_date);
  if (from.kind === "month" && starts > from.month) {
    return { card: "late-start", account, from: from.month, starts };
  }

  const kind = account.kind ?? held.kind;
  if (kind === null) return { card: "kind", account };
  if (account.needs_opening && held.opening === null) {
    return { card: "balance", account, kind, date: opening.date };
  }
  return {
    card: "confirm",
    account,
    kind,
    opening: account.needs_opening
      ? { from: "typed", date: opening.date, amount: held.opening! }
      : opening.amount === null
        ? { from: "books" }
        : { from: "statements", date: opening.date, amount: opening.amount },
    categorizer,
  };
}

/**
 * The gap a refusal names between two of the account's files, when both
 * have dates; null for any other refusal.
 */
function gapOf(
  account: AddAccountCandidate,
  files: readonly AddAccountFile[],
  refusal: StatementImportError,
): Gap | null {
  if (
    refusal.error !== "statement_boundary_mismatch" ||
    refusal.reason !== "gap"
  ) {
    return null;
  }
  const period = (name: string) => {
    const file = files.find((one) => one.file_name === name);
    return file?.status === "read" ? file.period : null;
  };
  const earlier = period(refusal.earlier_source);
  const later = period(refusal.later_source);
  if (earlier === null || later === null) return null;
  return {
    endsIn: monthOf(earlier.last_date),
    resumesIn: monthOf(later.first_date),
    // The account's files that end before the later file starts.
    before: positions(
      files,
      (file) =>
        file.status === "read" &&
        file.account_key === account.key &&
        file.period !== null &&
        file.period.last_date < later.first_date,
    ),
  };
}

/** The positions in the drop of the files `test` picks. */
function positions(
  files: readonly AddAccountFile[],
  test: (file: AddAccountFile) => boolean,
): number[] {
  return files.flatMap((file, i) => (test(file) ? [i] : []));
}
