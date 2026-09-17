import { randomBytes } from "node:crypto";
import { writeFile, unlink, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { projectPath, projectRoot } from "@sapporta/server";

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
 * Stages a batch of uploads under the project's own `tmp/<subdir>/<stamp>`
 * rather than the OS temp directory, and tells the handler where they landed.
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
  subdir: string,
  handler: (staged: StagedUploads) => Promise<T>,
): Promise<T> {
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const dir = projectPath(
    "tmp",
    subdir,
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
