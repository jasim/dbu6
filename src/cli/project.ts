/**
 * The project folder a command works on, and its environment file. Every
 * command resolves both the same way before it does anything else.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { packageDir } from "../server/paths.js";

/**
 * `DBU6_ROOT` when it is set, otherwise the nearest directory at or above the
 * working directory with a package.json, otherwise the working directory. It
 * is written back to `DBU6_ROOT`, which is what `paths.ts` reads, so the
 * command, the server and every child process agree.
 */
export function resolveProjectRoot(cwd = process.cwd()): string {
  const root = process.env.DBU6_ROOT
    ? resolve(cwd, process.env.DBU6_ROOT)
    : (nearestPackageJsonDir(cwd) ?? cwd);
  process.env.DBU6_ROOT = root;
  return root;
}

function nearestPackageJsonDir(start: string): string | null {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** Whether this dbu6 is its repository, with src/, rather than an install. */
export function runsFromSource(): boolean {
  return existsSync(packageDir("src", "server"));
}

/**
 * Whether `root` is dbu6's own repository being used as a project folder,
 * which is how dbu6 is developed. A user's project has dbu6 in node_modules.
 */
export function isSourceCheckout(root: string): boolean {
  return runsFromSource() && realpathSync(root) === realpathSync(packageDir());
}

/**
 * The project's environment file: `.env`. In dbu6's own repository it is
 * `.env.development`, as it was before the repository became a project.
 */
export function envFile(root: string): string {
  return join(root, isSourceCheckout(root) ? ".env.development" : ".env");
}

/**
 * Loads the environment file when there is one. A value already in the
 * environment wins, so a shell export, mise or a container overrides the file
 * without editing it, and a deployment that sets everything needs no file.
 */
export function loadProjectEnv(root: string): void {
  const file = envFile(root);
  if (existsSync(file)) process.loadEnvFile(file);
}
