import type {
  AccountKind,
  AddAccountCandidate,
  LlmStatus,
  StatementAccounts,
} from "../../shared/index";
import {
  formatMonth,
  formatMonthSpan,
  joinNames,
  maskIdentifier,
  monthName,
  plural,
} from "../format";
import type { FocusFrame } from "../components/focus-card";
import { suggestedName } from "./confirm-form";
import { addMonths, monthOf, type AddUrl, type From, type Gap } from "./state";

/*
 * What /add's cards say. `addCard` (state.ts) decides which card shows;
 * these put its facts into words, few and precise.
 */

/**
 * Two months as a sentence joins them: "Feb and Apr 2025" (or "Feb and Apr"
 * where the card already says the year), and across a year "Dec 2024 and
 * Feb 2025".
 */
function twoMonths(
  a: string,
  b: string,
  joiner: string,
  withYear: boolean,
): string {
  if (a === b) return formatMonth(a);
  if (a.slice(0, 4) !== b.slice(0, 4)) {
    return `${formatMonth(a)}${joiner}${formatMonth(b)}`;
  }
  const year = withYear ? ` ${b.slice(0, 4)}` : "";
  return `${monthName(Number(a.slice(5)))}${joiner}${monthName(Number(b.slice(5)))}${year}`;
}

/** Card 2's question. */
export function howFarBackTitle(url: AddUrl): string {
  return url.setup
    ? "How far back should your books go?"
    : "How far back do you want this bank or card's transactions?";
}

/** Under card 2's choice: what to fetch from the bank before dropping. */
export function downloadLine(from: From): string {
  return from.kind === "latest"
    ? "Download your latest statement, then come back."
    : `Download your statements from ${formatMonth(from.month)} to now, then come back.`;
}

/** The first run's steps, as the list over its cards names them. */
export type SetupStep = "chart" | "banks" | "other";

const SETUP_STEPS: readonly SetupStep[] = ["chart", "banks", "other"];

/**
 * The frame of a first-run card: the flow, and its steps with the banks
 * and cards in the books counted, so a return to /add counts the same.
 * Review, the last step, is the app's own page.
 */
export function setupFrame(at: SetupStep, inBooks: number): FocusFrame {
  return {
    flow: "Set up your books",
    steps: {
      list: [
        { label: "Chart" },
        {
          label: "Banks & cards",
          note: inBooks === 0 ? undefined : `${inBooks} added`,
        },
        { label: "Cash & loans" },
        { label: "Review" },
      ],
      at: SETUP_STEPS.indexOf(at),
    },
  };
}

/** /add's frame: the first run's step, or a later add on its own. */
export function addFrame(url: AddUrl, inBooks: number): FocusFrame {
  return url.setup
    ? setupFrame("banks", inBooks)
    : { flow: "Add a bank or card" };
}

/** The banks and cards the books hold transactions for. */
export function accountsInBooks(data: StatementAccounts): number {
  return data.accounts.filter(
    (row) => row.in_ledger && (row.entries > 0 || row.drafts > 0),
  ).length;
}

/** Card 5's account, by the books; null until they are read. */
export function addedName(
  accountId: number,
  data: StatementAccounts | undefined,
): string | null {
  return (
    data?.accounts.find((row) => row.account_id === accountId)?.name ?? null
  );
}

/**
 * What to call an account the statements belong to: its name in the books,
 * else the name Confirm will suggest, else its bank.
 */
export function candidateName(
  account: AddAccountCandidate,
  kind: AccountKind | null,
  data: StatementAccounts | undefined,
): string {
  if (account.account) return account.account.name;
  const suggested =
    kind !== null && data !== undefined
      ? suggestedName(kind, account.institution, data)
      : "";
  if (suggested !== "") return suggested;
  return account.institution === "" ? "This account" : account.institution;
}

/** How the one-account-at-a-time card names each account. */
function candidateLabel(
  account: AddAccountCandidate,
  data: StatementAccounts | undefined,
): string {
  const name = candidateName(account, account.kind, data);
  return account.identifier === null
    ? name
    : `${name} ${maskIdentifier(account.identifier)}`;
}

/** "These are from Sample Savings ending 0012 and Sample Credit Card …." */
export function severalTitle(
  accounts: readonly AddAccountCandidate[],
  data: StatementAccounts | undefined,
): string {
  return `These are from ${joinNames(accounts.map((one) => candidateLabel(one, data)))}.`;
}

/** "A statement between Feb and Apr 2025 is missing". */
export function gapTitle(gap: Gap): string {
  return `A statement between ${twoMonths(gap.endsIn, gap.resumesIn, " and ", true)} is missing`;
}

/** The gap and late-start cards' way on without the months: "Start from Apr". */
export function startFromLabel(month: string): string {
  return `Start from ${monthName(Number(month.slice(5, 7)))}`;
}

/** "These start in Mar 2025, not Jan". */
export function lateStartTitle(from: string, starts: string): string {
  const sameYear = from.slice(0, 4) === starts.slice(0, 4);
  const asked = sameYear
    ? monthName(Number(from.slice(5, 7)))
    : formatMonth(from);
  return `These start in ${formatMonth(starts)}, not ${asked}`;
}

/** The late-start card's "Add Jan–Feb": the months still to drop. */
export function addMonthsLabel(from: string, starts: string): string {
  return `Add ${twoMonths(from, addMonths(starts, -1), "–", false)}`;
}

/** Card 4's facts as a line: "Jan 2025 – Aug 2026 · 612 transactions". */
export function periodLine(account: AddAccountCandidate): string {
  const parts: string[] = [];
  if (account.period) {
    parts.push(
      formatMonthSpan(
        monthOf(account.period.first_date),
        monthOf(account.period.last_date),
      ),
    );
  }
  parts.push(plural(account.transactions, "transaction"));
  return parts.join(" · ");
}

/**
 * Card 4's title: "Sample Bank · ending 0505"; with no bank printed,
 * "Account ending 0505" or "Card ending 0505".
 */
export function bankLine(
  account: Pick<AddAccountCandidate, "institution" | "identifier">,
  kind: AccountKind,
): string {
  const noun = kind === "card" ? "Card" : "Account";
  if (account.identifier === null) {
    return account.institution === ""
      ? `New ${noun.toLowerCase()}`
      : account.institution;
  }
  const ending = maskIdentifier(account.identifier);
  return account.institution === ""
    ? `${noun} ${ending}`
    : `${account.institution} · ${ending}`;
}

/** Card 4's categorizer fact: who, or why nobody. */
export function categorizerLine(categorizer: LlmStatus): string {
  return categorizer.ready
    ? `Categorized by ${categorizer.name}`
    : `Not categorized: ${categorizer.reason}`;
}

/** The balance card's question. */
export function balanceTitle(
  name: string,
  kind: AccountKind,
  day: string,
): string {
  return kind === "card"
    ? `What did you owe on ${name} on ${day}?`
    : `What did ${name} hold on ${day}?`;
}
