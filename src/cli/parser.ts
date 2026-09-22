/**
 * `dbu6 parser test [name]` and `dbu6 parser run <name> <input>`: a parser or
 * its tests, run the way the importer runs a parser, with the bundled `shared`
 * package on PYTHONPATH (`parserProcessEnv`). The parsers guide promises both.
 * `dbu6 check` runs the project's parser tests through `runParserTest` too.
 */
import { spawnSync } from "node:child_process";
import { existsSync, globSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  parserDirectory,
  parserProcessEnv,
} from "../server/modules/statement-sources/index.js";
import { parserRoots } from "../server/paths.js";

/** Every `*_test.py` of the project's `custom-built-parsers/`, sorted. */
export function projectParserTests(): string[] {
  return parserTestsIn(parserRoots()[0], "*/*_test.py");
}

function parserTestsIn(directory: string, pattern: string): string[] {
  return globSync(pattern, { cwd: directory })
    .map((test) => join(directory, test))
    .sort();
}

export interface ParserTestRun {
  test: string;
  /** The exit code; null when uv could not be started. */
  status: number | null;
  /** stdout and stderr together, when they were captured. */
  output: string;
  /** Why uv could not be started, when it could not. */
  error?: Error;
}

/**
 * Runs one test file under uv. `inherit` streams its output to the terminal;
 * `pipe` collects it into `output`, for a report that shows it only on failure.
 */
export function runParserTest(
  test: string,
  stdio: "inherit" | "pipe",
): ParserTestRun {
  // From the parsers directory, as a test reads its fixtures relative to it.
  const { status, error, stdout, stderr } = spawnSync(
    "uv",
    ["run", "--quiet", test],
    {
      cwd: dirname(dirname(test)),
      stdio,
      env: parserProcessEnv(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return {
    test,
    status,
    output: stdio === "pipe" ? `${stdout ?? ""}${stderr ?? ""}` : "",
    ...(error ? { error } : {}),
  };
}

/**
 * Runs the tests of one parser, found the way the importer finds it, or of
 * every parser in the project's `custom-built-parsers/`. The parsers bundled
 * with dbu6 ship without their tests. Returns the exit code.
 */
export async function testParsers(name: string | undefined): Promise<number> {
  const projectParsers = parserRoots()[0];
  let tests: string[];
  if (name === undefined) {
    tests = projectParserTests();
  } else {
    const directory =
      (await parserDirectory(name)) ?? existingDirectory(projectParsers, name);
    if (directory === null) {
      console.error(`There is no parser named ${name}.`);
      return 1;
    }
    tests = parserTestsIn(directory, "*_test.py");
  }
  if (tests.length === 0) {
    console.log(
      name === undefined
        ? `No parser tests in ${projectParsers}.`
        : `${name} has no tests (*_test.py). Parsers bundled with dbu6 ship without theirs.`,
    );
    return 0;
  }

  const failed: string[] = [];
  for (const test of tests) {
    console.log(`\n> ${test}`);
    const { status, error } = runParserTest(test, "inherit");
    if (error) return uvMissing(error);
    if (status !== 0) failed.push(test);
  }
  if (failed.length > 0) {
    console.error(`\nFailed:\n${failed.map((test) => `  ${test}`).join("\n")}`);
    return 1;
  }
  console.log(`\n${tests.length} parser test files passed.`);
  return 0;
}

// `shared/` has tests and no parser.py, so `parserDirectory` does not find it.
function existingDirectory(parent: string, name: string): string | null {
  const directory = join(parent, name);
  return existsSync(directory) ? directory : null;
}

/** Runs a parser on a statement file; the parser writes the Abacus JSON. */
export async function runParser(name: string, input: string): Promise<number> {
  const directory = await parserDirectory(name);
  if (directory === null) {
    console.error(
      `There is no parser named ${name} in:\n${parserRoots()
        .map((root) => `  ${root}`)
        .join("\n")}`,
    );
    return 1;
  }
  const { status, error } = spawnSync(
    "uv",
    ["run", join(directory, "parser.py"), resolve(input)],
    { stdio: "inherit", env: parserProcessEnv() },
  );
  if (error) return uvMissing(error);
  return status ?? 1;
}

/** What to tell someone whose machine has no uv. */
export const UV_INSTALL_HINT =
  "uv runs the statement parsers. Install it from https://docs.astral.sh/uv/.";

function uvMissing(error: Error): number {
  console.error(`Could not run uv: ${error.message}\n${UV_INSTALL_HINT}`);
  return 1;
}
