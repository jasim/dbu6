// Formatting for the import screens: money, dates, and identifiers in the
// words a statement reader would use, never in ledger notation.

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return inr.format(value);
}

// A ledger balance as the user thinks of it. A credit card's ledger balance
// is negative when money is owed, so it is read out as an amount owed.
export function formatBalance(
  value: number | null,
  isCreditCard: boolean,
): string {
  if (value === null) return "not printed";
  if (!isCreditCard) return formatMoney(value);
  if (value === 0) return "nothing owed";
  if (value < 0) return `${formatMoney(Math.abs(value))} owed`;
  return `${formatMoney(value)} in credit`;
}

// A signed difference with an explicit sign, for net changes.
export function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return formatMoney(0);
  return `${rounded > 0 ? "+" : "−"}${formatMoney(Math.abs(rounded))}`;
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

// "2026-08-01" -> "1 Aug 2026". Anything else is returned untouched.
export function formatDate(iso: string): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  return `${parts.d} ${MONTHS[parts.m - 1]} ${parts.y}`;
}

// "1 Aug to 31 Aug 2026" when both dates share a year, else two full dates.
export function formatDateRange(from: string, to: string): string {
  const a = isoParts(from);
  const b = isoParts(to);
  if (!a || !b) return `${formatDate(from)} to ${formatDate(to)}`;
  if (from === to) return formatDate(from);
  if (a.y === b.y) {
    return `${a.d} ${MONTHS[a.m - 1]} to ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  }
  return `${formatDate(from)} to ${formatDate(to)}`;
}

// An account or card number is shown by its last four characters only.
export function maskIdentifier(identifier: string): string {
  return `ending ${identifier.slice(-4)}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// "a", "a and b", "a, b and c".
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// custom-built-parsers/<name>/parser.py -> <name>
export function parserLabel(parserPath: string): string {
  const parts = parserPath.split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : parserPath;
}
