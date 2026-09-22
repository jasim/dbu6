/**
 * `dbu6 init <directory>`: a person's new books folder. It renders the
 * package's `template/` into the directory, installs dbu6 there, runs the
 * installed package's `setup` and `migrate`, and makes the first commit.
 *
 * The template is written in Sapporta's `%%SAPPORTA:NAME%%` token form, so a
 * template file is a plain copy of what the project gets, with two values
 * filled in: the project's name (from the directory) and dbu6's exact version
 * (this package's). Sapporta's `createProject` scaffolds its own pnpm
 * workspace and does not export its renderer, so the few lines it takes live
 * here, with the same token grammar.
 *
 * Everything that reaches the shell goes through `run`, which a test
 * replaces; `main.ts` passes the real one. After `npm install` the work is the
 * installed package's, not this process's, so `setup` and `migrate` run as
 * its commands: `init` may be an older dbu6 than the one it installs.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { packageDir } from "../server/paths.js";
import type { RunCommand } from "./upgrade.js";

export interface InitOptions {
  /** The project folder to create: absent, or an empty directory. */
  target: string;
  run: RunCommand;
  /**
   * What the project's package.json depends on for dbu6. Left out, this
   * package's exact version, from the registry. For an unpublished build, a
   * tarball: `file:/path/to/dbu6-1.2.3.tgz`.
   */
  dbu6?: string;
  log?: (line: string) => void;
}

export interface InitResult {
  root: string;
  /** The package name written to package.json. */
  name: string;
  /** The dbu6 version the project is pinned to. */
  version: string;
  /** False when git is not installed or could not commit; the note says why. */
  committed: boolean;
}

/** A file the template renders to, relative to the project root. */
export interface RenderedFile {
  path: string;
  content: string;
}

const USAGE = "Usage: dbu6 init <directory> [--dbu6 <spec>]";

/** `dbu6 init` as the command line calls it. Resolves to the exit code. */
export async function initCommand(
  args: string[],
  run: RunCommand,
): Promise<number> {
  let parsed: ReturnType<
    typeof parseArgs<{
      options: { dbu6: { type: "string" } };
      allowPositionals: true;
    }>
  >;
  try {
    parsed = parseArgs({
      args,
      options: { dbu6: { type: "string" } },
      allowPositionals: true,
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 1;
  }
  if (parsed.positionals.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  await initProject({
    target: resolve(parsed.positionals[0]),
    dbu6: parsed.values.dbu6,
    run,
  });
  return 0;
}

export async function initProject(options: InitOptions): Promise<InitResult> {
  const { run, log = console.log } = options;
  const root = resolve(options.target);
  assertEmptyTarget(root);

  const version = packageVersion();
  const name = projectSlug(basename(root));
  const files = renderTemplate(packageDir("template"), {
    "%%SAPPORTA:SLUG%%": name,
    "%%SAPPORTA:DBU6_VERSION%%": options.dbu6 ?? version,
  });
  log(`Creating ${root}`);
  for (const file of files) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    log(`  ${file.path}`);
  }

  const leftAsItIs = `${root} is left as it is; remove it and run \`dbu6 init\` again.`;
  log(`\nInstalling dbu6 ${options.dbu6 ?? version}`);
  if ((await run("npm", ["install"], { cwd: root })).status !== 0) {
    throw new Error(`npm install failed in ${root}. ${leftAsItIs}`);
  }
  await ensureSqliteBinding(root, run, log);

  const command = join(root, "node_modules", "dbu6", "bin", "dbu6.mjs");
  for (const step of ["setup", "migrate"]) {
    log(`\ndbu6 ${step}`);
    const { status } = await run(process.execPath, [command, step], {
      cwd: root,
    });
    if (status !== 0) {
      throw new Error(`dbu6 ${step} failed in ${root}. ${leftAsItIs}`);
    }
  }

  const committed = await firstCommit(root, run, log);

  log(
    [
      "",
      `Your books are in ${root}.`,
      `  cd ${basename(root)}`,
      "  npx dbu6 dev",
      "then open http://localhost:2345 and sign up. AGENTS.md tells a coding",
      "agent how to work in this folder.",
    ].join("\n"),
  );
  return { root, name, version, committed };
}

/**
 * The target is created by `init`, so it must not hold anything: a folder
 * that already has files is someone's, and nothing here is merged into it.
 */
function assertEmptyTarget(root: string): void {
  if (!existsSync(root)) return;
  if (!statSync(root).isDirectory()) {
    throw new Error(`${root} exists and is not a directory.`);
  }
  if (readdirSync(root).length > 0) {
    throw new Error(
      `${root} is not empty. \`dbu6 init\` creates a new folder; give it a name that does not exist yet, or an empty directory.`,
    );
  }
}

/**
 * The package name: the directory's name in the form npm accepts, the way
 * Sapporta's `slugifyProjectName` does it.
 */
export function projectSlug(directoryName: string): string {
  const slug = directoryName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return slug === "" ? "my-books" : slug;
}

function packageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(packageDir("package.json"), "utf8"),
  ) as { version: string };
  return manifest.version;
}

const TEMPLATE_TOKEN = /%%SAPPORTA:[A-Z0-9_]+%%/g;

/**
 * Every file under the template directory with its tokens replaced. A token
 * that no variable names stops the render, naming the file: a project must
 * never receive one.
 *
 * npm drops a `.gitignore` from a published package, so the template keeps it
 * as `gitignore` and it is renamed here.
 */
export function renderTemplate(
  templateDir: string,
  variables: Record<string, string>,
): RenderedFile[] {
  const files: RenderedFile[] = [];
  const walk = (dir: string, prefix: string) => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .map((entry) => ({
        entry,
        name: entry.name === "gitignore" ? ".gitignore" : entry.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const { entry, name } of entries) {
      const source = join(dir, entry.name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (entry.isDirectory()) {
        walk(source, path);
        continue;
      }
      let content = readFileSync(source, "utf8");
      for (const [token, value] of Object.entries(variables)) {
        content = content.replaceAll(token, value);
      }
      const unresolved = content.match(TEMPLATE_TOKEN);
      if (unresolved) {
        throw new Error(
          `template/${path} has a token init does not fill in: ${unresolved[0]}`,
        );
      }
      files.push({ path, content });
    }
  };
  walk(templateDir, "");
  return files;
}

/** Exits 1, quietly, when the binding is missing; `init` says what it does about it. */
export const SQLITE_PROBE =
  'try { new (require("better-sqlite3"))(":memory:").close() } catch { process.exit(1) }';

/**
 * An npm configured with `ignore-scripts` installs better-sqlite3 without
 * building its binding, and then nothing that opens the database runs. It is
 * the one install script dbu6 needs, so when the binding does not load it is
 * built by name, which respects the setting for every other package.
 */
async function ensureSqliteBinding(
  root: string,
  run: RunCommand,
  log: (line: string) => void,
): Promise<void> {
  // Opening a database is what loads the binding; requiring the package
  // alone does not.
  const loads = await run(process.execPath, ["-e", SQLITE_PROBE], {
    cwd: root,
  });
  if (loads.status === 0) return;
  log(
    "better-sqlite3's native binding was not built (npm is configured with ignore-scripts); building it.",
  );
  const rebuilt = await run(
    "npm",
    ["rebuild", "better-sqlite3", "--ignore-scripts=false"],
    { cwd: root },
  );
  if (rebuilt.status !== 0) {
    throw new Error(
      `better-sqlite3's native binding did not build in ${root}; dbu6 cannot open a database without it.`,
    );
  }
}

/**
 * The first commit, when git is installed: the project is worth versioning
 * from its first minute, and `data/` and `.env` are already ignored. Git's
 * identity is never configured here; a commit that fails for the lack of one
 * leaves the files staged and says so.
 */
async function firstCommit(
  root: string,
  run: RunCommand,
  log: (line: string) => void,
): Promise<boolean> {
  const git = (args: string[]) => run("git", args, { cwd: root });
  try {
    if ((await git(["--version"])).status !== 0) throw new Error("no git");
  } catch {
    log("\ngit is not installed, so the project was not committed.");
    return false;
  }
  log("\nMaking the first commit");
  if (
    (await git(["init"])).status !== 0 ||
    (await git(["add", "."])).status !== 0
  ) {
    log(
      "git could not initialize a repository here; the project is not committed.",
    );
    return false;
  }
  if ((await git(["commit", "-m", "Create dbu6 project"])).status !== 0) {
    log(
      "git could not commit (is your name and email configured?). The files are staged; commit them yourself.",
    );
    return false;
  }
  return true;
}
