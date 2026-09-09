import { writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export function uploadedFile(files: unknown, key: string): File | null {
  if (!files || typeof files !== "object") return null;
  const value = (files as Record<string, unknown>)[key];
  return value instanceof File && value.size > 0 ? value : null;
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

export async function withTempUploads<T>(
  files: File[],
  prefix: string,
  handler: (workDir: string, paths: string[]) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  try {
    const paths = await Promise.all(
      files.map(async (f, i) => {
        const safe = basename(f.name) || "upload";
        const uniqueName = `${i}-${safe}`;
        const p = join(workDir, uniqueName);
        await writeFile(p, Buffer.from(await f.arrayBuffer()));
        return p;
      }),
    );
    return await handler(workDir, paths);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
