import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  statementInboxContract,
  type StatementInboxBatch,
  type StatementInboxDrop,
} from "../../shared/index.js";
import { projectRoot, statementInboxDir } from "../paths.js";
import {
  batchFileName,
  batchName,
  filesFromField,
  readBatchFileName,
  type ProjectFile,
} from "./upload-tmp.js";
import { requireOwner } from "./workflow-auth.js";

/*
 * The statement inbox: the user drops every statement they have, the app
 * saves them as one batch under tmp/statement-inbox/<batch>/, and hands their
 * coding agent a prompt that names the inbox. Nothing here reads a statement
 * or touches the books. The agent's run sends inbox files to the imports by
 * their `saved_path` (`inbox_files`), and each import deletes its files
 * once their rows are in the drafts (`deleteInboxFiles`); a batch with none
 * left goes with it, so no copy of the statements lingers. Discarding a file
 * deletes it unimported, when the person doesn't want it imported. A file
 * dropped again, the same bytes under any name,
 * is not saved twice. The owner's only, like every upload.
 */

const api = new TsRestApi<SapportaEnv>();

api.register(
  "listStatementInbox",
  statementInboxContract.listStatementInbox,
  async ({ c }) => {
    requireOwner(c);
    return { status: 200, body: { batches: await listInbox() } };
  },
);

api.register(
  "saveToStatementInbox",
  statementInboxContract.saveToStatementInbox,
  async ({ c, files }) => {
    requireOwner(c);
    const statements = filesFromField(files, "files");
    if (statements.length === 0) {
      return {
        status: 400,
        body: { error: "Send at least one statement as `files`." },
      };
    }
    return { status: 200, body: await saveToInbox(statements) };
  },
);

api.register(
  "discardFromStatementInbox",
  statementInboxContract.discardFromStatementInbox,
  async ({ c, request }) => {
    requireOwner(c);
    const { saved_path } = request.body;
    const file = await inboxFile(saved_path);
    if (file === null) {
      return {
        status: 404,
        body: { error: `${saved_path} isn't a file in the statement inbox` },
      };
    }
    await deleteInboxFiles([file]);
    return { status: 200, body: { discarded: saved_path } };
  },
);

api.register(
  "discardStatementInbox",
  statementInboxContract.discardStatementInbox,
  async ({ c }) => {
    requireOwner(c);
    return { status: 200, body: { discarded: await discardInbox() } };
  },
);

export default api;

/**
 * Saves the files new to the inbox as one batch, in the order they came. A
 * file whose bytes already wait there, or came earlier in this drop, is
 * skipped and named; with none new, no batch folder is made.
 */
export async function saveToInbox(
  files: readonly File[],
): Promise<StatementInboxDrop> {
  const seen = await inboxDigests();
  const fresh: { file: File; bytes: Buffer }[] = [];
  const already_uploaded: string[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const digest = digestOf(bytes);
    if (seen.has(digest)) {
      already_uploaded.push(file.name);
      continue;
    }
    seen.add(digest);
    fresh.push({ file, bytes });
  }
  const batch = batchName();
  if (fresh.length === 0) return { batch, files: [], already_uploaded };
  const dir = join(statementInboxDir(), batch);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const saved = await Promise.all(
    fresh.map(async ({ file, bytes }, index) => {
      const path = join(dir, batchFileName(file, index));
      await writeFile(path, bytes, { mode: 0o600 });
      return {
        file_name: file.name,
        saved_path: relative(projectRoot(), path),
        bytes: bytes.length,
      };
    }),
  );
  return { batch, files: saved, already_uploaded };
}

// The digests of every file waiting in the inbox. The inbox holds one
// person's statements for one run, so reading them all is cheap.
async function inboxDigests(): Promise<Set<string>> {
  const batches = await listInbox();
  const digests = await Promise.all(
    batches.flatMap((batch) =>
      batch.files.map(async (file) =>
        digestOf(await readFile(resolve(projectRoot(), file.saved_path))),
      ),
    ),
  );
  return new Set(digests);
}

function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every batch waiting, oldest first; an empty inbox has none. */
export async function listInbox(): Promise<StatementInboxBatch[]> {
  const batches = await entries(statementInboxDir());
  const listed = await Promise.all(
    batches.map(async (batch) => {
      const dir = join(statementInboxDir(), batch);
      if (!(await stat(dir)).isDirectory()) return null;
      const names = await entries(dir);
      const files = await Promise.all(
        names.map(async (saved) => {
          const { index, name } = readBatchFileName(saved);
          return {
            file_name: name,
            saved_path: relative(projectRoot(), join(dir, saved)),
            bytes: (await stat(join(dir, saved))).size,
            index,
          };
        }),
      );
      files.sort((left, right) => left.index - right.index);
      return {
        batch,
        files: files.map(({ index: _index, ...file }) => file),
      };
    }),
  );
  return listed.filter((batch) => batch !== null);
}

/**
 * The inbox files a request names in its `inbox_files` field (repeated, each
 * a `saved_path` as the listing gives it), staged where they are; or, in the
 * user's words, why the first one that isn't a file in the inbox is refused.
 */
export async function inboxFilesFromField(
  body: unknown,
): Promise<{ files: ProjectFile[] } | { notInInbox: string }> {
  const raw =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>).inbox_files
      : undefined;
  const named = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value !== "");
  const files: ProjectFile[] = [];
  for (const savedPath of named) {
    const file = await inboxFile(savedPath);
    if (file === null) {
      return {
        notInInbox: `${savedPath} isn't a file in the statement inbox: GET /api/statement-inbox lists them.`,
      };
    }
    files.push(file);
  }
  return { files };
}

/**
 * Deletes inbox files, by their absolute paths, and each batch left empty;
 * returns their `saved_path`s, as the listing gives them.
 */
export async function deleteInboxFiles(
  files: readonly ProjectFile[],
): Promise<string[]> {
  for (const file of files) await rm(file.path, { force: true });
  for (const dir of new Set(files.map((file) => dirname(file.path)))) {
    // Only an empty folder goes; one with files left keeps them.
    await rmdir(dir).catch(() => {});
  }
  return files.map((file) => relative(projectRoot(), file.path));
}

/** Deletes every file waiting, unimported, and its batch; returns how many. */
export async function discardInbox(): Promise<number> {
  const batches = await listInbox();
  for (const { batch } of batches) {
    await rm(join(statementInboxDir(), batch), {
      recursive: true,
      force: true,
    });
  }
  return batches.reduce((sum, batch) => sum + batch.files.length, 0);
}

// A `saved_path` that is a file in a batch of the inbox, or null.
async function inboxFile(savedPath: string): Promise<ProjectFile | null> {
  const path = resolve(projectRoot(), savedPath);
  const batchDir = dirname(path);
  if (dirname(batchDir) !== statementInboxDir()) return null;
  const isFile = await stat(path)
    .then((found) => found.isFile())
    .catch(() => false);
  if (!isFile) return null;
  return { name: readBatchFileName(basename(path)).name, path };
}

// A folder's entries by name, sorted; a missing folder has none. Batch names
// start with their time, so sorting puts the oldest first.
async function entries(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
