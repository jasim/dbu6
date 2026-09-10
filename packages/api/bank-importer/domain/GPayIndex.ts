import { readFileSync } from "node:fs";
import type { Abacus } from "./Abacus.js";
import { isWithdrawal } from "./Money.js";

export type GPayIndex = Map<string, string[]>;

const DATE_DELTAS = [0, -1, 1] as const;

export function parseGPayHtml(path: string): GPayIndex {
  const html = readFileSync(path, "utf-8");
  const idx: GPayIndex = new Map();
  for (const entry of extractEntries(htmlToPlaintext(html))) {
    const k = key(entry.date, entry.amount);
    const bucket = idx.get(k);
    if (bucket) bucket.push(entry.recipient);
    else idx.set(k, [entry.recipient]);
  }
  return idx;
}

export interface EnrichmentResult {
  enriched: Abacus[];
  matchCount: number;
}

export interface HtmlEnrichmentResult extends EnrichmentResult {
  indexSize: number;
}

export function enrichWithGPayHtml(
  txns: readonly Abacus[],
  htmlPath: string,
): HtmlEnrichmentResult {
  const idx = parseGPayHtml(htmlPath);
  return { ...enrichWithGPay(txns, idx), indexSize: idx.size };
}

export function enrichWithGPay(
  txns: readonly Abacus[],
  idx: GPayIndex,
): EnrichmentResult {
  const available = new Map(
    [...idx].map(([entryKey, recipients]) => [entryKey, [...recipients]]),
  );
  const enriched = [...txns];
  const assigned = new Set<number>();
  let matchCount = 0;

  // Match the whole batch in passes so an exact-date transaction always gets
  // first claim on a GPay activity before the ±1-day settlement fallback.
  for (const delta of DATE_DELTAS) {
    const transactionGroups = groupUnassignedTransactions(
      txns,
      assigned,
      delta,
    );
    for (const [entryKey, transactionIndexes] of transactionGroups) {
      const recipients = available.get(entryKey);
      if (!recipients || recipients.length === 0) continue;

      while (transactionIndexes.length > 0 && recipients.length > 0) {
        const assignment = chooseAssignment(
          txns,
          transactionIndexes,
          recipients,
        );
        const transactionIndex = transactionIndexes.splice(
          assignment.transactionPosition,
          1,
        )[0];
        const recipient = recipients.splice(assignment.recipientPosition, 1)[0];
        const transaction = enriched[transactionIndex];
        const prefix = `${recipient} | `;

        assigned.add(transactionIndex);
        if (transaction.narration.startsWith(prefix)) continue;
        enriched[transactionIndex] = {
          ...transaction,
          narration: `${prefix}${transaction.narration}`,
        };
        matchCount++;
      }
    }
  }

  return { enriched, matchCount };
}

function groupUnassignedTransactions(
  txns: readonly Abacus[],
  assigned: Set<number>,
  delta: number,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  txns.forEach((transaction, index) => {
    if (assigned.has(index) || !isWithdrawal(transaction)) return;
    const entryKey = key(
      shiftDate(transaction.date, delta),
      normAmount(transaction.withdrawal),
    );
    const group = groups.get(entryKey);
    if (group) group.push(index);
    else groups.set(entryKey, [index]);
  });
  return groups;
}

function chooseAssignment(
  txns: readonly Abacus[],
  transactionIndexes: number[],
  recipients: string[],
): { transactionPosition: number; recipientPosition: number } {
  for (
    let recipientPosition = 0;
    recipientPosition < recipients.length;
    recipientPosition++
  ) {
    const matchingTransactionPositions = transactionIndexes.flatMap(
      (transactionIndex, transactionPosition) =>
        narrationNamesRecipient(
          txns[transactionIndex].narration,
          recipients[recipientPosition],
        )
          ? [transactionPosition]
          : [],
    );
    if (matchingTransactionPositions.length === 1) {
      return {
        transactionPosition: matchingTransactionPositions[0],
        recipientPosition,
      };
    }
  }

  if (transactionIndexes.length > 1 || recipients.length > 1) {
    const transaction = txns[transactionIndexes[0]];
    console.warn(
      `[gpay] ambiguous match for ${transaction.date} ${normAmount(transaction.withdrawal)}: ` +
        `${recipients.join(" | ")} - using first unmatched activity`,
    );
  }
  return { transactionPosition: 0, recipientPosition: 0 };
}

function narrationNamesRecipient(
  narration: string,
  recipient: string,
): boolean {
  const normalizedRecipient = normalizePartyName(recipient);
  return (
    normalizedRecipient.length >= 4 &&
    normalizePartyName(narration).includes(normalizedRecipient)
  );
}

function normalizePartyName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

interface GPayEntry {
  date: string;
  amount: number;
  recipient: string;
}

function key(date: string, amount: number): string {
  return `${date}|${amount.toFixed(2)}`;
}

function normAmount(n: number): number {
  return Number(n.toFixed(2));
}

function shiftDate(date: string, days: number): string {
  if (days === 0) return date;
  const d = new Date(Date.parse(date) + days * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const BLOCK_TAGS = /<\/?(?:br|p|div|h[1-6]|li|tr|td)\b[^>]*>/gi;

function htmlToPlaintext(html: string): string {
  const withBreaks = html.replace(BLOCK_TAGS, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return decoded.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

const AMOUNT_LINE =
  /^\s*(?:Sent|Paid)\s+(?:Rs\.?\s*|\u20b9\s*|\$\s*)?([\d,]+(?:\.\d+)?)\s+to\s+(.+?)(?:\s+using\s+Bank\s+Account.*)?$/i;

function extractEntries(plaintext: string): GPayEntry[] {
  const out: GPayEntry[] = [];
  let pending: { amount: number; recipient: string } | null = null;

  for (const raw of plaintext.split("\n")) {
    const line = raw.trim();
    if (!pending) {
      const m = AMOUNT_LINE.exec(line);
      if (!m) continue;
      const amount = parseAmount(m[1]);
      const recipient = m[2].trim();
      if (amount === null || !recipient) continue;
      pending = { amount, recipient };
    } else {
      if (!line) continue;
      const date = parseGPayDate(line);
      if (date) {
        out.push({
          date,
          amount: pending.amount,
          recipient: pending.recipient,
        });
      }
      pending = null;
    }
  }
  return out;
}

function parseAmount(s: string): number | null {
  const n = parseFloat(s.replace(/[\u20b9$,]/g, ""));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const DATE_RE = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4}),/;

function parseGPayDate(line: string): string | null {
  const m = DATE_RE.exec(line);
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
