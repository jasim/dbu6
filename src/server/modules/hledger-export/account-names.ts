import type { ExportAccount } from "./model.js";

/**
 * One account's own name as one hledger account segment, safe to print
 * wherever hledger reads an account name. hledger's names are permissive
 * (any text, single spaces, `;`, `#`, digits, any script), so only what
 * changes how a line parses is rewritten:
 *
 * - NFC, so one name has one spelling.
 * - Control characters, tabs, newlines and any other Unicode whitespace
 *   become a space. Two spaces, or a space and a tab, end an account name
 *   and silently turn the rest into the amount; a newline ends the line.
 * - `:` becomes `-`. A colon separates segments, so a name holding one would
 *   split into a parent and a child, and an empty side makes a blank node.
 * - Runs of spaces collapse to one and the ends are trimmed, for the same
 *   two-space rule, and since a trailing space is invisible.
 * - A leading `*` or `!` is read as the posting's status, and a posting line
 *   starting with `;` is a comment: they are dropped.
 * - A name wrapped in `(…)` or `[…]` is a virtual posting, so a leading `(`
 *   or `[` is dropped with its first matching closer: `(Old) Savings` is
 *   `Old Savings`.
 * - What is left empty becomes `fallback`.
 */
export function escapeAccountSegment(name: string, fallback: string): string {
  let segment = collapse(
    name
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\s]/gu, " ")
      .replace(/:/g, "-"),
  );
  for (;;) {
    const next = collapse(dropLeadingSyntax(segment));
    if (next === segment) break;
    segment = next;
  }
  return segment === "" ? fallback : segment;
}

function dropLeadingSyntax(segment: string): string {
  const first = segment[0];
  if (first === "*" || first === "!" || first === ";") {
    return segment.slice(1);
  }
  if (first === "(" || first === "[") {
    const closer = segment.indexOf(first === "(" ? ")" : "]");
    return closer === -1
      ? segment.slice(1)
      : segment.slice(1, closer) + " " + segment.slice(closer + 1);
  }
  return segment;
}

function collapse(text: string): string {
  return text.replace(/ {2,}/g, " ").trim();
}

/**
 * Each account's full hledger name, by id: its escaped segments from the top
 * of its branch down to it, joined by colons, as `Expenses:Food:Dining Out`.
 * The branch comes from `parent_id`, never from the names. Escaping can make
 * two accounts' paths the same (`A:B` and `A-B` under one parent); the later
 * one by id then ends its own segment in `-<id>`, and its children sit under
 * that. Throws on a parent loop, which the database refuses.
 */
export function hledgerAccountPaths(
  accounts: readonly ExportAccount[],
): Map<number, string> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const depths = new Map<number, number>();
  const depthOf = (account: ExportAccount): number => {
    const seen = new Set<number>();
    let depth = 0;
    let current = account;
    while (current.parent_id !== null) {
      if (seen.has(current.id)) {
        throw new Error(`parent_id loops through account ${current.id}`);
      }
      seen.add(current.id);
      const parent = byId.get(current.parent_id);
      if (parent === undefined) break;
      current = parent;
      depth += 1;
    }
    return depth;
  };
  for (const account of accounts) depths.set(account.id, depthOf(account));

  // Parents before children, and by id within a level, so which of two
  // colliding accounts keeps the plain name never depends on row order.
  const ordered = [...accounts].sort(
    (a, b) => depths.get(a.id)! - depths.get(b.id)! || a.id - b.id,
  );
  const paths = new Map<number, string>();
  const taken = new Set<string>();
  for (const account of ordered) {
    const parentPath =
      account.parent_id === null ? undefined : paths.get(account.parent_id);
    const prefix = parentPath === undefined ? "" : `${parentPath}:`;
    const segment = escapeAccountSegment(account.name, `account-${account.id}`);
    let path = `${prefix}${segment}`;
    if (taken.has(path)) path = `${prefix}${segment}-${account.id}`;
    taken.add(path);
    paths.set(account.id, path);
  }
  return paths;
}
