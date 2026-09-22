/**
 * `dbu6 upgrade [version]`: move the project's pin, install, show what the
 * new versions say to the project's agent, migrate safely, check. If the
 * database does not come through the migration verified, the project is put
 * back on the version it was on; `migrateSafely` has left the database as it
 * found it, so the two then match again.
 *
 * It refuses a version older than the installed one.
 *
 * The process running this is the old version. Once the new one is installed,
 * migrating and checking are the new version's job, so they run as its
 * commands, not as calls into code already loaded here. Every command goes
 * through `run`, which a test replaces.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CommandResult {
  status: number;
  /** What the command printed, when `capture` was asked for. */
  stdout: string;
}

export type RunCommand = (
  command: string,
  args: string[],
  options: { cwd: string; capture?: boolean },
) => Promise<CommandResult>;

export type UpgradeResult =
  | { status: "unchanged"; version: string }
  | { status: "upgraded"; from: string; to: string; checkPassed: boolean }
  | { status: "rolled-back"; from: string; to: string; reason: string };

export interface UpgradeOptions {
  root: string;
  /** An exact version. Left out, the latest published one. */
  version?: string;
  run: RunCommand;
  log?: (line: string) => void;
}

const PACKAGE = "dbu6";
const MANIFEST = "package.json";
const LOCKFILE = "package-lock.json";

export async function upgradeProject(
  options: UpgradeOptions,
): Promise<UpgradeResult> {
  const { root, run, log = console.log } = options;
  const manifestPath = join(root, MANIFEST);
  const remembered = rememberFiles(root, [MANIFEST, LOCKFILE]);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const pin = manifest.dependencies?.[PACKAGE];
  if (pin === undefined) {
    throw new Error(`${manifestPath} does not depend on ${PACKAGE}.`);
  }
  const from = installedVersion(root) ?? pin;
  const to = options.version ?? (await latestVersion(run, root));
  if (!EXACT_VERSION.test(to)) {
    throw new Error(
      `"${to}" is not an exact version. A project pins ${PACKAGE} exactly, as in 1.2.3.`,
    );
  }
  if (to === from && pin === to) return { status: "unchanged", version: to };
  // A database the newer version migrated may hold migrations the older one
  // does not have, and the older one refuses to serve it. dbu6 keeps no copy
  // of the books to go back to, so it does not downgrade.
  if (compareVersions(to, from) < 0) {
    throw new Error(
      `${PACKAGE} ${to} is older than ${from}, the version installed. dbu6 does not downgrade: ` +
        `the database may hold migrations ${to} does not have.`,
    );
  }

  const rollBack = async (reason: string): Promise<UpgradeResult> => {
    remembered.restore();
    const reinstall = await run("npm", ["install"], { cwd: root });
    log(
      reinstall.status === 0
        ? `\n${reason}\nThe project is back on ${PACKAGE} ${from}, and its database is untouched.`
        : `\n${reason}\n${MANIFEST} and ${LOCKFILE} are back on ${PACKAGE} ${from}, but reinstalling it failed. ` +
            "Run `npm install` before starting dbu6. The database is untouched.",
    );
    return { status: "rolled-back", from, to, reason };
  };

  log(`Upgrading ${PACKAGE} from ${from} to ${to}.`);
  manifest.dependencies = { ...manifest.dependencies, [PACKAGE]: to };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const install = await run("npm", ["install"], { cwd: root });
  if (install.status !== 0) {
    return rollBack(`Installing ${PACKAGE} ${to} failed.`);
  }

  for (const note of upgradeNotes(installedDir(root), from, to)) {
    log(`\n--- Upgrade notes for ${note.version} ---\n${note.text.trimEnd()}`);
  }

  const command = join(installedDir(root), "bin", "dbu6.mjs");
  const migrate = await run(process.execPath, [command, "migrate"], {
    cwd: root,
  });
  if (migrate.status !== 0) {
    return rollBack(`The database did not migrate to ${PACKAGE} ${to}; see above.`);
  }
  const check = await run(process.execPath, [command, "check"], { cwd: root });
  const checkPassed = check.status === 0;
  log(
    checkPassed
      ? `\nUpgraded to ${PACKAGE} ${to}.`
      : `\nUpgraded to ${PACKAGE} ${to}. \`dbu6 check\` found problems, listed above; fix them before relying on this project.`,
  );
  return { status: "upgraded", from, to, checkPassed };
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const installedDir = (root: string) => join(root, "node_modules", PACKAGE);

function installedVersion(root: string): string | null {
  const manifest = join(installedDir(root), MANIFEST);
  if (!existsSync(manifest)) return null;
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
    .version;
}

async function latestVersion(run: RunCommand, root: string): Promise<string> {
  const { status, stdout } = await run("npm", ["view", PACKAGE, "version"], {
    cwd: root,
    capture: true,
  });
  if (status !== 0 || stdout.trim() === "") {
    throw new Error(`Could not ask npm for the latest version of ${PACKAGE}.`);
  }
  return stdout.trim();
}

/** The files' contents now, or that they were absent, to put back later. */
function rememberFiles(root: string, names: string[]): { restore: () => void } {
  const contents = names.map((name) => {
    const path = join(root, name);
    return { path, content: existsSync(path) ? readFileSync(path) : null };
  });
  return {
    restore() {
      for (const { path, content } of contents) {
        if (content === null) rmSync(path, { force: true });
        else writeFileSync(path, content);
      }
    },
  };
}

/**
 * The notes of every version after `from` up to `to`, oldest first, from the
 * installed package's `docs/upgrade-notes/<version>.md`. A release with
 * nothing to say has no file.
 */
export function upgradeNotes(
  packageDir: string,
  from: string,
  to: string,
): { version: string; text: string }[] {
  const dir = join(packageDir, "docs", "upgrade-notes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .filter(
      (version) =>
        EXACT_VERSION.test(version) &&
        compareVersions(version, from) > 0 &&
        compareVersions(version, to) <= 0,
    )
    .sort(compareVersions)
    .map((version) => ({
      version,
      text: readFileSync(join(dir, `${version}.md`), "utf8"),
    }));
}

/** Semver precedence, as far as `x.y.z` and a prerelease tag go. */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core, ...prerelease] = version.split("-");
    return { core: core.split(".").map(Number), tag: prerelease.join("-") };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const difference = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (difference !== 0) return difference;
  }
  // A prerelease comes before its release.
  if (left.tag === right.tag) return 0;
  if (left.tag === "") return 1;
  if (right.tag === "") return -1;
  return left.tag.localeCompare(right.tag, "en", { numeric: true });
}
