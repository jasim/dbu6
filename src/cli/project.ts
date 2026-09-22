/**
 * The project folder a command works on, and its environment file. Every
 * command resolves both the same way before it does anything else.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { databaseFile, packageDir } from "../server/paths.js";

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

/**
 * What `dbu6 dev` finds in `root`. It sets up only an `"empty"` folder, one
 * holding nothing but hidden files such as .DS_Store or .git. Anywhere else it
 * creates and overwrites nothing, so a folder with files but no database is
 * refused instead of being made into a project.
 */
export function devFolder(root: string): "empty" | "project" {
  if (readdirSync(root).every((name) => name.startsWith("."))) return "empty";
  const database = databaseFile(root);
  if (!existsSync(database)) {
    throw new Error(
      `${root} has files in it but no database at ${database}, so \`dbu6 dev\` creates nothing here. Run it in a project folder, or in an empty folder to start a project there.`,
    );
  }
  return "project";
}

/** Whether this dbu6 is its repository, with src/, rather than an install. */
export function runsFromSource(): boolean {
  return existsSync(packageDir("src", "server"));
}

/** The project's environment file. */
export function envFile(root: string): string {
  return join(root, ".env");
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
