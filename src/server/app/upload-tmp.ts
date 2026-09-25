import { randomBytes } from "node:crypto";
import { writeFile, unlink, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { projectRoot, uploadStagingDir } from "../paths.js";

export function uploadedFile(files: unknown, key: string): File | null {
  if (!files || typeof files !== "object") return null;
  const value = (files as Record<string, unknown>)[key];
  return value instanceof File && value.size > 0 ? value : null;
}

// Every non-empty file uploaded under a repeated multipart field.
export function filesFromField(files: unknown, key: string): File[] {
  if (!files || typeof files !== "object") return [];
  const raw = (files as Record<string, unknown>)[key];
  const candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return candidates.filter((f): f is File => f instanceof File && f.size > 0);
}

export async function withTempUpload<T>(
  file: File,
  prefix: string,
  extension: string,
  handler: (filePath: string) => Promise<T>,
): Promise<T> {
  const tmpPath = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`,
  );
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(tmpPath, buf);
    return await handler(tmpPath);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/** A batch of uploads written inside the project, and what became of them. */
export interface StagedUploads {
  /** Where each upload was written, in the order the files came. */
  paths: string[];
  /** The same paths relative to the project root, as a prompt prints them. */
  projectPaths: string[];
  /** Keeps the batch on disk instead of deleting it when the handler ends. */
  keep(): void;
}

/**
 * Stages a batch of uploads under the project's own
 * `tmp/statement-uploads/<stamp>` rather than the OS temp directory, and tells the handler where they landed.
 * A coding agent the user hands a prompt to starts in the project root, so a
 * file staged under it is one the agent can open by the path the prompt
 * prints: it never has to search the disk or ask where the upload went. tmp/
 * is gitignored.
 *
 * The batch is deleted when the handler returns unless it called `keep()`, so
 * only uploads a prompt points at leave a copy of the user's file behind.
 */
export async function withStagedUploads<T>(
  files: readonly File[],
  handler: (staged: StagedUploads) => Promise<T>,
): Promise<T> {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const dir = join(
    uploadStagingDir(),
    `${stamp}-${randomBytes(2).toString("hex")}`,
  );
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let keep = false;
  try {
    const paths = await Promise.all(
      files.map(async (file, index) => {
        // The index keeps two uploads of one name apart; the name itself is
        // kept because it is what the bank called the statement.
        const staged = join(dir, `${index}-${basename(file.name) || "upload"}`);
        await writeFile(staged, Buffer.from(await file.arrayBuffer()), {
          mode: 0o600,
        });
        return staged;
      }),
    );
    return await handler({
      paths,
      projectPaths: paths.map((path) => relative(projectRoot(), path)),
      keep: () => {
        keep = true;
      },
    });
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/*
 * The setup wizard's sample statements: at most one per preset account, in
 * `tmp/statement-uploads/setup-sample-<account id>/`, kept while a coding
 * agent writes a parser for it. The directory's name is how a sample is
 * found again, so the wizard keeps no record of its own.
 */

const SAMPLE_DIR_RE = /^setup-sample-(\d+)$/;

/** A staged sample: where it is, and that path relative to the project. */
export interface StagedSample {
  path: string;
  projectPath: string;
}

function sampleDir(accountId: number): string {
  return join(uploadStagingDir(), `setup-sample-${accountId}`);
}

/** Stages `file` as the account's sample, replacing any earlier one. */
export async function stageSample(
  accountId: number,
  file: File,
): Promise<StagedSample> {
  const dir = sampleDir(accountId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, basename(file.name) || "upload");
  await writeFile(path, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  return { path, projectPath: relative(projectRoot(), path) };
}

/** Each account's staged sample, by account id. */
export async function stagedSamples(): Promise<Map<number, StagedSample>> {
  let entries: string[];
  try {
    entries = await readdir(uploadStagingDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const samples = new Map<number, StagedSample>();
  for (const entry of entries) {
    const accountId = Number(SAMPLE_DIR_RE.exec(entry)?.[1]);
    if (!Number.isInteger(accountId) || accountId <= 0) continue;
    // The parsers write their JSON beside the statement; that isn't it.
    const [name] = (await readdir(sampleDir(accountId))).filter(
      (file) => !file.endsWith(".abacus.json"),
    );
    if (name === undefined) continue;
    const path = join(sampleDir(accountId), name);
    samples.set(accountId, {
      path,
      projectPath: relative(projectRoot(), path),
    });
  }
  return samples;
}

/** Deletes the account's staged sample; whether there was one. */
export async function removeStagedSample(accountId: number): Promise<boolean> {
  const had = (await stagedSamples()).has(accountId);
  await rm(sampleDir(accountId), { recursive: true, force: true });
  return had;
}
