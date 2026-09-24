import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { projectRoot as sapportaProjectRoot } from "@sapporta/server";

/**
 * Where everything is. Two directories matter, and every path dbu6 touches is
 * derived from one of them here, so no other file joins onto a root itself.
 *
 * - The **project root** is the user's folder: their config, parsers, reports
 *   and data, and the tmp/ a coding agent is pointed at.
 * - The **package directory** is ours: the bundled parsers and the guides.
 *
 * In a user's project the package sits under node_modules, or links there to
 * dbu6's repository while dbu6 is worked on, so nothing of ours may be looked
 * up from the project root, and nothing of theirs from the package. The
 * repository itself is not a project; only `dbu6 parser` runs with the two the
 * same directory there.
 *
 * Everything is resolved per call rather than at module load, so DBU6_ROOT
 * stays effective whatever the import order, and a test can point the root at
 * a temporary directory with `vi.stubEnv("DBU6_ROOT", dir)`.
 */

/**
 * The project root: `DBU6_ROOT` when it is set (absolute, or relative to the
 * working directory), otherwise the Sapporta project root.
 */
export function projectRoot(): string {
  const configured = process.env.DBU6_ROOT;
  return configured ? resolve(configured) : sapportaProjectRoot();
}

/** The project's `data/`. `databaseFile` looks elsewhere while SAPPORTA_DATA_DIR is set. */
export function dataDir(root: string = projectRoot()): string {
  return join(root, "data");
}

/**
 * `sqlite.db` in the project's `data/`, or in SAPPORTA_DATA_DIR when that is
 * set, because Drizzle Kit reads the same variable and every tool must open
 * the same database. A relative SAPPORTA_DATA_DIR is resolved against `root`,
 * which is what Sapporta means by it too; never against the checkout the
 * running `dbu6` came from, which may hold someone's real books.
 */
export function databaseFile(root: string): string {
  const configured = process.env.SAPPORTA_DATA_DIR;
  const dir = configured ? resolve(root, configured) : dataDir(root);
  return join(dir, "sqlite.db");
}

/** Our Drizzle migrations, which ship in the package. */
export function dbu6MigrationsDir(): string {
  return packageDir("migrations");
}

/** Where transaction_mappings.mjs, the prompts and settings.json live. */
export function userConfigDir(root: string = projectRoot()): string {
  return join(root, "user-config");
}

export function userConfigPath(...segments: string[]): string {
  return join(userConfigDir(), ...segments);
}

/** The user's reports, one folder each. */
export function reportsDir(root: string = projectRoot()): string {
  return join(root, "reports");
}

/**
 * Where uploads that did not import are kept for a coding agent to read. It is
 * inside the project because the agent starts in the project root, so a prompt
 * can print a path the agent can open. tmp/ is gitignored.
 */
export function uploadStagingDir(): string {
  return join(projectRoot(), "tmp", "statement-uploads");
}

/** The name `packageDir` looks for in package.json. */
const PACKAGE_NAME = "dbu6";

let foundPackageDir: string | undefined;

/**
 * Join segments onto our own package's directory: bundled parsers, guides,
 * migrations and the prebuilt app.
 *
 * It is found by walking up from this file to the nearest package.json named
 * `dbu6`, never from the project root. The walk gives the same answer from
 * src/server (tests), from dist/server (the running server), and from
 * node_modules/dbu6/dist/server in a user's project; a package.json with
 * another name on the way up is passed over.
 */
export function packageDir(...segments: string[]): string {
  foundPackageDir ??= findPackageDir(import.meta.dirname);
  return join(foundPackageDir, ...segments);
}

function findPackageDir(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
      };
      if (name === PACKAGE_NAME) return dir;
    }
    if (dirname(dir) === dir) {
      throw new Error(
        `No package.json named "${PACKAGE_NAME}" found walking up from ${start}.`,
      );
    }
  }
}

const PARSERS_DIR = "custom-built-parsers";

/** Our bundled parsers, and the `shared` Python package every parser imports. */
export function packageParsersDir(): string {
  return packageDir(PARSERS_DIR);
}

/**
 * The directories saved parsers are looked up in, in order: the user's, then
 * ours, so a user's parser shadows ours of the same name. One directory when
 * the two are the same (`dbu6 parser` in this repository), compared by real
 * path.
 */
export function parserRoots(root: string = projectRoot()): string[] {
  const roots = [join(root, PARSERS_DIR), packageParsersDir()];
  const seen = new Set<string>();
  return roots.filter((root) => {
    const real = realPathOrSelf(root);
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
}

// A root that does not exist yet (a project with no parsers of its own) has
// no real path; it stays in the list and simply holds nothing.
function realPathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw err;
  }
}
