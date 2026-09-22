/**
 * `dbu6.lock`, beside the database: the pid of the one process that may write
 * the database's schema or serve it. The server holds it while it serves
 * (`serveDbu6`), and `migrateSafely` holds it while it swaps the file, so a
 * migration never runs under a live server and two servers never share a
 * folder.
 *
 * The lock is a file created with `wx`, which fails when the file exists. A
 * lock whose pid is no longer running was left by a crash or a kill and is
 * taken over. A pid that the operating system has since given to another
 * program looks live; the error names the file so a person can delete it.
 */
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const LOCK_FILE = "dbu6.lock";

export class DataLockHeldError extends Error {
  constructor(
    readonly lockPath: string,
    readonly pid: number,
  ) {
    super(
      `Another dbu6 process (pid ${pid}) is using this folder. Stop it first. ` +
        `If no such process is running, delete ${lockPath}.`,
    );
    this.name = "DataLockHeldError";
  }
}

export interface DataLock {
  /** Deletes the lock file if it is still ours. Safe to call twice. */
  release: () => void;
}

/**
 * Takes the lock in `dir` (the directory holding `sqlite.db`), or throws
 * `DataLockHeldError` when a running process holds it. The lock is also
 * released when this process exits normally.
 */
export function acquireDataLock(dir: string): DataLock {
  const lockPath = join(dir, LOCK_FILE);
  // Two attempts: the second follows the removal of a stale lock. Two
  // processes that both find a lock stale can both pass here; that needs two
  // starts within the same millisecond after a crash, and is not defended.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (tryCreate(lockPath)) return ownedLock(lockPath);
    const holder = readHolder(lockPath);
    if (holder !== null && isRunning(holder)) {
      throw new DataLockHeldError(lockPath, holder);
    }
    rmSync(lockPath, { force: true });
  }
  throw new Error(`Could not take ${lockPath}.`);
}

function tryCreate(lockPath: string): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    writeSync(fd, `${process.pid}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

function ownedLock(lockPath: string): DataLock {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off("exit", release);
    if (readHolder(lockPath) === process.pid) rmSync(lockPath, { force: true });
  };
  process.on("exit", release);
  return { release };
}

/** The pid in the lock file, or null when it is missing or unreadable. */
function readHolder(lockPath: string): number | null {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists and belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
