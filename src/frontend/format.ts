// Formatting for the everyday screens: money, dates, and identifiers in the
// words a statement reader would use, never in ledger notation.

import type { AccountKind, DateSpan, StatementAccount } from "../shared/index";

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// An amount in Indian digit grouping, with no currency sign: "1,20,000.00".
export function formatMoney(value: number): string {
  return money.format(value);
}

// A ledger balance as the user thinks of it. A card's ledger balance is
// negative when money is owed, so it is read out as an amount owed.
export function formatBalance(value: number, kind: AccountKind): string {
  if (kind === "bank") return formatMoney(value);
  if (value === 0) return "nothing owed";
  if (value < 0) return `${formatMoney(Math.abs(value))} owed`;
  return `${formatMoney(value)} in credit`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isoParts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return { y: Number(match[1]), m, d: Number(match[3]) };
}

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type MonthNames = "short" | "long";

// 3 -> "Mar", or "March" with long names.
export function monthName(month: number, names: MonthNames = "short"): string {
  return (names === "long" ? LONG_MONTHS : MONTHS)[month - 1]!;
}

// "2026-08-01" -> "1 Aug 2026". Anything else is returned untouched.
export function formatDate(iso: string): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  return `${parts.d} ${MONTHS[parts.m - 1]} ${parts.y}`;
}

// "2026-08-01" -> "1 Aug", the everyday screens' date. Anything else is
// returned untouched.
export function formatShortDate(iso: string): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  return `${parts.d} ${MONTHS[parts.m - 1]}`;
}

// A span of days as a sentence reads it: "1–13 Sep", "28 Aug – 13 Sep", or
// across a new year "28 Dec 2025 – 3 Jan 2026". `withYear` adds the year to
// a span within one year: "1–13 Sep 2026". `months: "long"` spells the
// months out: "1 October 2025 – 16 September 2026".
export function formatDaySpan(
  { first_date: from, last_date: to }: DateSpan,
  {
    withYear = false,
    months = "short",
  }: { withYear?: boolean; months?: MonthNames } = {},
): string {
  const a = isoParts(from);
  const b = isoParts(to);
  if (!a || !b) return `${formatDate(from)} – ${formatDate(to)}`;
  const day = (p: { d: number; m: number }) =>
    `${p.d} ${monthName(p.m, months)}`;
  if (a.y !== b.y) return `${day(a)} ${a.y} – ${day(b)} ${b.y}`;
  const year = withYear ? ` ${b.y}` : "";
  if (from === to) return `${day(a)}${year}`;
  if (a.m === b.m) return `${a.d}–${day(b)}${year}`;
  return `${day(a)} – ${day(b)}${year}`;
}

// "2026-03" -> "Mar 2026", or "March 2026" with long month names.
export function formatMonth(
  month: string,
  months: MonthNames = "short",
): string {
  const parts = isoParts(`${month}-01`);
  if (!parts) return month;
  return `${monthName(parts.m, months)} ${parts.y}`;
}

// A span of whole months: "Mar 2026", "Mar – Jun 2026", or across a new
// year "Nov 2025 – Feb 2026". Months are `YYYY-MM`.
export function formatMonthSpan(from: string, to: string): string {
  const a = isoParts(`${from}-01`);
  const b = isoParts(`${to}-01`);
  if (!a || !b) return `${from} – ${to}`;
  if (from === to) return formatMonth(from);
  if (a.y !== b.y) return `${formatMonth(from)} – ${formatMonth(to)}`;
  return `${monthName(a.m)} – ${monthName(b.m)} ${b.y}`;
}

// "1 Aug to 31 Aug 2026" when both dates share a year, else two full dates.
// `joiner` reads the span into a sentence: "between 1 Apr and 30 Apr 2026".
export function formatDateRange(
  { first_date: from, last_date: to }: DateSpan,
  joiner = "to",
): string {
  const a = isoParts(from);
  const b = isoParts(to);
  if (!a || !b) return `${formatDate(from)} ${joiner} ${formatDate(to)}`;
  if (from === to) return formatDate(from);
  if (a.y === b.y) {
    return `${a.d} ${MONTHS[a.m - 1]} ${joiner} ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  }
  return `${formatDate(from)} ${joiner} ${formatDate(to)}`;
}

// An account or card number is shown by its last four characters only.
export function maskIdentifier(identifier: string): string {
  return `ending ${identifier.slice(-4)}`;
}

// What a statement says it is for: "card ending 0505", "account ending 0505".
export function describeStatementAccount(account: StatementAccount): string {
  return `${account.kind === "card" ? "card" : "account"} ${maskIdentifier(account.identifier)}`;
}

// A file's size as a file manager shows it: "840 B", "24 KB", "1.2 MB".
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The file type a tile shows: the extension, uppercased. "statement.xls" ->
// "XLS"; a name with no extension, or an unreadably long one, -> "FILE".
export function fileTypeLabel(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot <= 0 ? "" : fileName.slice(dot + 1);
  if (extension === "" || extension.length > 4) return "FILE";
  return extension.toUpperCase();
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// The verb that agrees with a count: agree(1, "fails", "fail") -> "fails".
export function agree(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// "a", "a and b", "a, b and c".
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// A parser is named by its directory, e.g. `hdfc-bank-xls`, which is also its
// label. A path, as presets named parsers before, is still read for its
// directory.
export function parserLabel(parserPath: string): string {
  const parts = parserPath.split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : parserPath;
}
