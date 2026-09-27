import { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { CommentWriterStatus } from "../../shared/index.js";
import {
  categorizationIdle,
  type CategorizationLlm,
} from "../modules/categorization/index.js";
import { categorizationLlm } from "../modules/coding-agent/index.js";
import {
  COMMENT_OUTPUT_FIELD,
  COMMENT_PROMPT,
  COMMENTS_PER_CALL,
  commentRequestRows,
  commentVerdicts,
} from "../modules/comment-writer/index.js";
import {
  uncommentedDraftTexts,
  writeDraftComment,
} from "../modules/drafts/index.js";
import {
  uncommentedEntryTexts,
  writeEntryComment,
} from "../modules/journals/index.js";

/*
 * The comment writer: fills every null comment, on drafts first and then on
 * journal entries, from its source narration. One answer fills every row with
 * that text. It runs in this process, one run at a time; a trigger during a
 * run makes it go round again. It keeps no job table: the work is always
 * whatever comment is still null, so a restart loses nothing.
 *
 * Categorization goes first: before each call it waits until no import or Run
 * categorizer is categorizing. A call already sent finishes.
 */

/** After this many failed answers, the automatic triggers leave a text. */
export const MAX_FAILURES = 3;

// Calls sent at once after the first, which goes alone.
const CALLS_AT_ONCE = 2;

const COMMENT_OUTPUT = { name: COMMENT_OUTPUT_FIELD, schema: z.string() };

export interface CommentWriterDeps {
  db: BetterSQLite3Database;
  /** The engine to call, asked afresh at each run. */
  llm: () => Promise<CategorizationLlm>;
  /** Settles when no categorization is running. */
  categorizationIdle: () => Promise<void>;
}

export interface CommentWriter {
  /** Starts a run, or has the running one go round again. */
  trigger(): void;
  /** Forgets the failures and the error, then triggers. */
  retry(): void;
  status(): CommentWriterStatus;
  /** Settles once no run is going. */
  settled(): Promise<void>;
}

export function createCommentWriter(deps: CommentWriterDeps): CommentWriter {
  const { db } = deps;
  // Failed answers by text, until a retry or a restart.
  const failures = new Map<string, number>();
  let lastError: string | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  const failedOut = (text: string) => (failures.get(text) ?? 0) >= MAX_FAILURES;

  // Drafts first: the person is reviewing them now.
  const uncommentedTexts = () => [
    ...new Set([...uncommentedDraftTexts(db), ...uncommentedEntryTexts(db)]),
  ];

  const fail = (text: string, reason: string) => {
    failures.set(text, (failures.get(text) ?? 0) + 1);
    console.error(
      `[comment-writer] no comment for ${JSON.stringify(text)}: ${reason}`,
    );
  };

  const write = (text: string, comment: string) =>
    db.transaction((tx: any) => {
      writeDraftComment(tx, text, comment);
      writeEntryComment(tx, text, comment);
    });

  type ReadyCaller = Extract<CategorizationLlm["caller"], { ready: true }>;

  // One call for a batch of texts. False when the call itself failed; each
  // text it answered is written or counted.
  const send = async (caller: ReadyCaller, texts: string[]) => {
    await deps.categorizationIdle();
    const answer = await caller.client.list({
      prompt: COMMENT_PROMPT,
      rows: commentRequestRows(texts),
      output: COMMENT_OUTPUT,
    });
    if (!answer.ok) {
      console.error(`[comment-writer] call failed: ${answer.error}`);
      return false;
    }
    lastError = null;
    commentVerdicts(texts, answer.rows).forEach((verdict, index) => {
      const text = texts[index]!;
      if (verdict.ok) write(text, verdict.comment);
      else fail(text, verdict.reason);
    });
    return true;
  };

  const pass = async () => {
    const texts = uncommentedTexts().filter((text) => !failedOut(text));
    if (texts.length === 0) {
      lastError = null;
      return;
    }
    const llm = await deps.llm();
    if (!llm.caller.ready) {
      lastError = llm.caller.reason;
      console.error(`[comment-writer] ${llm.name} can't run: ${lastError}`);
      return;
    }
    const caller = llm.caller;
    const batches: string[][] = [];
    for (let start = 0; start < texts.length; start += COMMENTS_PER_CALL) {
      batches.push(texts.slice(start, start + COMMENTS_PER_CALL));
    }
    console.log(
      `[comment-writer] ${texts.length} text(s) in ${batches.length} call(s) on ${llm.name}`,
    );

    // The first call goes alone: when it fails, the engine may be unusable,
    // and then nothing else is sent and nothing counted.
    const [first, ...rest] = batches;
    if (!(await send(caller, first!))) {
      const unavailable = await caller.confirmUnavailable();
      if (unavailable !== null) {
        lastError = unavailable;
        console.error(`[comment-writer] stopped: ${unavailable}`);
        return;
      }
      for (const text of first!) fail(text, "the call failed");
    }
    let next = 0;
    const worker = async () => {
      while (next < rest.length) {
        const batch = rest[next++]!;
        if (!(await send(caller, batch))) {
          for (const text of batch) fail(text, "the call failed");
        }
      }
    };
    await Promise.all(Array.from({ length: CALLS_AT_ONCE }, worker));
  };

  const run = async () => {
    do {
      again = false;
      try {
        await pass();
      } catch (error) {
        console.error("[comment-writer] run failed:", error);
      }
    } while (again);
  };

  const writer: CommentWriter = {
    trigger() {
      if (running !== null) {
        again = true;
        return;
      }
      running = run().finally(() => {
        running = null;
      });
    },
    retry() {
      failures.clear();
      lastError = null;
      writer.trigger();
    },
    status() {
      const texts = uncommentedTexts();
      const failed = texts.filter(failedOut).length;
      return {
        running: running !== null,
        pending: texts.length - failed,
        failed,
        last_error: lastError,
      };
    },
    settled: () => running ?? Promise.resolve(),
  };
  return writer;
}

// --- The server's writer --------------------------------------------------

let started: CommentWriter | null = null;

/**
 * Starts the server's writer on its database and runs it: at startup, this
 * is what writes the comments still missing, the backlog after migration
 * 0012 included.
 */
export function startCommentWriter(db: BetterSQLite3Database): void {
  started = createCommentWriter({
    db,
    llm: categorizationLlm,
    categorizationIdle,
  });
  started.trigger();
}

/**
 * Has the server's writer look for comments to write, without waiting for
 * it: after an import saves drafts, and after drafts are posted. Does nothing
 * where no writer was started, as in tests.
 */
export function writeCommentsSoon(): void {
  started?.trigger();
}

/** How the server's writer is doing; an idle one's counts where none started. */
export function commentWriterStatus(
  db: BetterSQLite3Database,
): CommentWriterStatus {
  return (
    started ??
    createCommentWriter({
      db,
      llm: categorizationLlm,
      categorizationIdle,
    })
  ).status();
}

/** Retry: the server's writer forgets its failures and runs again. */
export function retryCommentWriter(
  db: BetterSQLite3Database,
): CommentWriterStatus {
  started?.retry();
  return commentWriterStatus(db);
}
