import type Database from "better-sqlite3";
import {
  postingBlocks,
  type NamedAccount,
  type PostingBlock,
} from "../../shared/index.js";
import { unsafeAsChrono } from "../modules/values/index.js";
import {
  deleteAccountDrafts,
  draftCounts,
  findFailingChecks,
  loadCategorizedDrafts,
  loadDraftStatus,
  loadOtherStatementDrafts,
  partitionByCategorization,
  type DraftAccountStatus,
  type FailingCheck,
  type OtherStatementDrafts,
} from "../modules/drafts/index.js";
import {
  planJournals,
  type JournalPlan,
  type PlannedJournal,
} from "../modules/journal-plan/index.js";
import {
  hasJournalsBesideOpenings,
  insertJournalPlan,
} from "../modules/journals/index.js";
import type { Ledger, LedgerAuth } from "../modules/ledger-sql/index.js";
import { countPostedAssertionFailures } from "../modules/reconciliation/index.js";

/*
 * Adding drafts to the books. A press is the set of accounts the person
 * adds at once: Add on one account presses that account, Add all every
 * account Review lists with drafts. `decidePress` decides which of them go
 * in, and `postPress` adds those in one transaction, so accounts whose
 * balance checks count each other's drafts go in together or not at all,
 * and no order between them is needed. The books' own balance checks are
 * read again inside that transaction: a press that would leave one failing
 * that passed before is rolled back, so the books never take entries that
 * miss a statement balance.
 */

/** What a press adds, and why each other account with drafts stays out. */
export interface PressDecision {
  /** The accounts that go in together, in the order they were pressed. */
  adds: number[];
  /** Each pressed account with drafts that stays out, and the block. */
  left: Map<number, PostingBlock>;
}

/**
 * Which of `press` go into the books together. It starts from the accounts
 * with drafts that nothing of their own blocks: the checks Review shows,
 * which count every account's drafts (`statuses`). Their balance checks are
 * then counted again with only the drafts of the accounts still in, and the
 * ones that fail drop out, round after round until none does. Dropping an
 * account takes its drafts out of the others' balances, so the set only
 * shrinks, and it ends within as many rounds as there are accounts. Accounts
 * that rely on each other stay in together; one that relies on an account
 * that isn't going in drops out, its block naming that account as `names`
 * names it. A pressed account with no drafts is neither added nor left.
 */
export function decidePress(
  sqlite: Database.Database,
  auth: LedgerAuth,
  press: readonly number[],
  statuses: ReadonlyMap<number, DraftAccountStatus>,
  names: ReadonlyMap<number, string>,
): PressDecision {
  const left = new Map<number, PostingBlock>();
  let adds: number[] = [];
  for (const accountId of new Set(press)) {
    const status = statuses.get(accountId);
    if (status === undefined) continue;
    const [block] = postingBlocks(draftCounts(status));
    if (block) left.set(accountId, block);
    else adds.push(accountId);
  }

  const dropped = new Map<number, FailingCheck[]>();
  while (adds.length > 0) {
    const failing = failingByAccount(
      findFailingChecks(sqlite, auth, { otherDrafts: adds }),
    );
    const still = adds.filter((accountId) => !failing.has(accountId));
    if (still.length === adds.length) break;
    for (const accountId of adds) {
      const checks = failing.get(accountId);
      if (checks) dropped.set(accountId, checks);
    }
    adds = still;
  }

  if (dropped.size > 0) {
    const others = loadOtherStatementDrafts(sqlite, auth);
    const going = new Set(adds);
    for (const [accountId, failing] of dropped) {
      left.set(
        accountId,
        failingChecksBlock(accountId, failing, others, going, names),
      );
    }
  }
  return { adds, left };
}

/**
 * The accounts each account's own Add would leave it waiting on, by id: for
 * each of `statuses` that nothing of its own blocks, but whose balance
 * checks fail counting no other statement's drafts, the accounts whose
 * drafts those checks count. Add on one account counts none but its own,
 * so one reading answers for every account. Add all adds it with them.
 */
export function reliesOnAlone(
  sqlite: Database.Database,
  auth: LedgerAuth,
  statuses: ReadonlyMap<number, DraftAccountStatus>,
  names: ReadonlyMap<number, string>,
): Map<number, NamedAccount[]> {
  const clear = [...statuses.values()]
    .filter((status) => postingBlocks(draftCounts(status)).length === 0)
    .map((status) => status.account_id);
  const reliance = new Map<number, NamedAccount[]>();
  if (clear.length === 0) return reliance;
  const failing = failingByAccount(
    findFailingChecks(sqlite, auth, { otherDrafts: [] }),
  );
  if (failing.size === 0) return reliance;
  const others = loadOtherStatementDrafts(sqlite, auth);
  for (const accountId of clear) {
    const checks = failing.get(accountId);
    if (checks === undefined) continue;
    const block = failingChecksBlock(
      accountId,
      checks,
      others,
      new Set(),
      names,
    );
    reliance.set(accountId, block.relies_on);
  }
  return reliance;
}

/** An account whose posted balance checks a press would leave failing. */
export interface BrokenCheck {
  accountId: number;
  name: string;
  /** How many more of its posted checks would fail. */
  failures: number;
}

export type PressOutcome =
  // Accounts not in the books; nothing was posted.
  | { kind: "accounts-not-found"; accountIds: number[] }
  // Posted, the books would miss balance checks they meet now; nothing was
  // posted.
  | { kind: "breaks-posted-checks"; broken: BrokenCheck[] }
  | {
      kind: "done";
      posted: { accountId: number; name: string; draftsPosted: number }[];
      left: { accountId: number; name: string; block: PostingBlock }[];
      journalsCreated: number;
      entriesCreated: number;
      // The books held nothing but opening balances before this post.
      firstPost: boolean;
    };

/**
 * Adds the accounts of `press` that `decidePress` lets in, all in one
 * transaction: a journal per draft, the drafts deleted. Only `press` is ever
 * posted; `names` names its accounts, and holds every account in the books.
 * Refuses, writing nothing, when the books would then miss a posted balance
 * check they meet now: the drafts' checks can pass in an order the books
 * can't hold (`postingOrder`).
 */
export function postPress(
  { db, sqlite, auth }: Ledger,
  press: readonly number[],
  names: ReadonlyMap<number, string>,
): PressOutcome {
  const missing = press.filter((id) => !names.has(id));
  if (missing.length > 0) {
    return { kind: "accounts-not-found", accountIds: missing };
  }
  const statuses = loadDraftStatus(sqlite, auth);
  const { adds, left } = decidePress(sqlite, auth, press, statuses, names);

  // The drafts and the statuses are read in one synchronous pass, so every
  // draft loaded here has an account, and none its own statement's: the
  // categorization check refused those, which `planJournals` would write as
  // two lines on one account.
  const plans = adds.map((accountId) => {
    const loaded = loadCategorizedDrafts(db, accountId, auth)!;
    const { categorized, uncategorized } = partitionByCategorization([
      ...loaded.categorized,
    ]);
    if (
      uncategorized.length > 0 ||
      categorized.some((draft) => draft.accountId === accountId)
    ) {
      throw new Error("Drafts changed while they were being posted.");
    }
    const plan = planJournals(
      unsafeAsChrono(
        categorized.map((draft) => ({
          transaction: draft.transaction,
          account: draft.accountId,
          assertion: draft.assertion,
          comment: draft.comment,
        })),
      ),
      accountId,
    );
    return { accountId, plan, drafts: loaded.drafts.length };
  });

  const firstPost = !hasJournalsBesideOpenings(sqlite, auth);
  const failingBefore = countPostedAssertionFailures(sqlite, auth);
  let broken: BrokenCheck[] = [];
  let inserted = { journals: 0, entries: 0 };
  if (plans.length > 0) {
    try {
      inserted = db.transaction((tx: any) => {
        const written = insertJournalPlan(tx, postingOrder(plans), auth);
        for (const accountId of adds) deleteAccountDrafts(tx, accountId, auth);
        // The same connection, so the count sees the rows just written.
        broken = newlyFailing(
          failingBefore,
          countPostedAssertionFailures(sqlite, auth),
          names,
        );
        if (broken.length > 0) throw ROLLBACK;
        return written;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
      return { kind: "breaks-posted-checks", broken };
    }
  }

  return {
    kind: "done",
    posted: plans.map(({ accountId, drafts }) => ({
      accountId,
      name: names.get(accountId)!,
      draftsPosted: drafts,
    })),
    left: [...left].map(([accountId, block]) => ({
      accountId,
      name: names.get(accountId)!,
      block,
    })),
    journalsCreated: inserted.journals,
    entriesCreated: inserted.entries,
    firstPost,
  };
}

export type PostingOutcome =
  | { kind: "account-not-found" }
  | { kind: "breaks-posted-checks"; broken: BrokenCheck[] }
  // The first thing that keeps the drafts off the books; nothing was
  // written.
  | { kind: "blocked"; block: PostingBlock; baseAccountName: string }
  | {
      kind: "posted";
      baseAccountName: string;
      journalsCreated: number;
      entriesCreated: number;
      draftsPosted: number;
      // The books held nothing but opening balances before this post.
      firstPost: boolean;
    };

/**
 * Add on one account: a press of that account alone. Refuses while
 * anything blocks it, a balance check that counts another account's drafts
 * included, naming that account as `names` names it.
 */
export function postDrafts(
  ledger: Ledger,
  baseAccountId: number,
  names: ReadonlyMap<number, string>,
): PostingOutcome {
  const loaded = loadCategorizedDrafts(ledger.db, baseAccountId, ledger.auth);
  if (loaded === null) return { kind: "account-not-found" };
  const outcome = postPress(ledger, [baseAccountId], names);
  if (outcome.kind === "accounts-not-found") {
    return { kind: "account-not-found" };
  }
  if (outcome.kind === "breaks-posted-checks") return outcome;
  const [refused] = outcome.left;
  if (refused) {
    return {
      kind: "blocked",
      block: refused.block,
      baseAccountName: loaded.baseAccountName,
    };
  }
  return {
    kind: "posted",
    baseAccountName: loaded.baseAccountName,
    journalsCreated: outcome.journalsCreated,
    entriesCreated: outcome.entriesCreated,
    draftsPosted: outcome.posted[0]?.draftsPosted ?? 0,
    firstPost: outcome.firstPost,
  };
}

/**
 * The journals of the accounts going in together, in the order they get
 * their ids, which is the order the books' balance assertions add them up
 * in within a day. By date; within a day each account's own in their
 * order, and before an account's first journal that asserts its balance,
 * every journal of the others that goes to it that day, as the draft
 * balance check counted them. When two accounts' asserting journals each
 * wait for the other, no order holds both; the first account's goes on,
 * and `postPress` refuses the press once the books' checks say so.
 */
export function postingOrder(
  plans: readonly { accountId: number; plan: JournalPlan<number> }[],
): JournalPlan<number> {
  const queues = plans.map(({ accountId, plan }) => ({
    accountId,
    journals: plan.map((journal) => ({
      journal,
      to: journal.entries.find((entry) => entry.account !== accountId)?.account,
      asserts: journal.entries.some(
        (entry) => entry.account === accountId && entry.assertion !== null,
      ),
    })),
  }));
  const ordered: PlannedJournal<number>[] = [];
  const dates = [
    ...new Set(plans.flatMap(({ plan }) => plan.map((one) => one.date))),
  ].sort();
  for (const date of dates) {
    const day = queues.map(({ accountId, journals }) => ({
      accountId,
      journals: journals.filter((one) => one.journal.date === date),
    }));
    const incoming = (accountId: number) =>
      day.some(
        (other) =>
          other.accountId !== accountId &&
          other.journals.some((one) => one.to === accountId),
      );
    for (;;) {
      let moved = false;
      for (const queue of day) {
        while (queue.journals.length > 0) {
          const [head] = queue.journals;
          if (head.asserts && incoming(queue.accountId)) break;
          ordered.push(queue.journals.shift()!.journal);
          moved = true;
        }
      }
      const waiting = day.find((queue) => queue.journals.length > 0);
      if (waiting === undefined) break;
      if (!moved) ordered.push(waiting.journals.shift()!.journal);
    }
  }
  return ordered;
}

// The balance-checks block for an account that drops out of a press: how
// many of its checks fail, and the accounts not `going` in whose drafts it
// counts on or before its last failing check.
function failingChecksBlock(
  accountId: number,
  failing: readonly FailingCheck[],
  others: readonly OtherStatementDrafts[],
  going: ReadonlySet<number>,
  names: ReadonlyMap<number, string>,
): Extract<PostingBlock, { kind: "balance-checks" }> {
  const last = failing[failing.length - 1].date;
  return {
    kind: "balance-checks",
    state: "blocks",
    severity: "problem",
    count: failing.length,
    relies_on: others
      .filter(
        (row) =>
          row.account_id === accountId &&
          !going.has(row.other_id) &&
          row.first_date <= last,
      )
      .map((row) => ({
        account_id: row.other_id,
        name: names.get(row.other_id) ?? `account ${row.other_id}`,
      })),
  };
}

// Thrown inside the transaction to roll it back.
const ROLLBACK = Symbol("rollback");

// The accounts with more failing posted checks `after` than `before`.
function newlyFailing(
  before: ReadonlyMap<number, number>,
  after: ReadonlyMap<number, number>,
  names: ReadonlyMap<number, string>,
): BrokenCheck[] {
  return [...after]
    .filter(([accountId, count]) => count > (before.get(accountId) ?? 0))
    .map(([accountId, count]) => ({
      accountId,
      name: names.get(accountId) ?? `account ${accountId}`,
      failures: count - (before.get(accountId) ?? 0),
    }));
}

function failingByAccount(
  rows: readonly FailingCheck[],
): Map<number, FailingCheck[]> {
  const byAccount = new Map<number, FailingCheck[]>();
  for (const row of rows) {
    const group = byAccount.get(row.account_id);
    if (group) group.push(row);
    else byAccount.set(row.account_id, [row]);
  }
  return byAccount;
}
