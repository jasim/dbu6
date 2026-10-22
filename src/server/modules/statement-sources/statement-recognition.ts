import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import {
  parseAbacusJson,
  type AbacusStatement,
  AbacusJsonParseError,
} from "../statement/index.js";
import {
  packageParsersDir,
  parserRoots,
  projectRoot,
  uploadStagingDir,
} from "../../paths.js";

// Recognizing an uploaded statement with the saved parsers: the directories
// of the project's custom-built-parsers/ and of the one bundled with dbu6. A
// parser is known by its directory's name, which is how a preset names it. A
// parser is its own executable fingerprint: it writes
// `<input>.abacus.json` only for a layout it fully accepts, so a parser that
// exits cleanly with a valid statement has recognized the file.

// What running every candidate parser over one upload established. Exactly
// one parser must claim the file; zero or several leave it unimportable.
export type StatementRecognition =
  | {
      outcome: "recognized";
      // As presets declare it, e.g. `hdfc-cc-xls`.
      parserName: string;
      statement: AbacusStatement;
    }
  | { outcome: "unrecognized"; candidateParserNames: string[] }
  | { outcome: "ambiguous"; matchingParserNames: string[] };

// A parser that exits non-zero, writes nothing, or writes an invalid
// statement has not recognized the file.
class ParserRejectedFile extends Error {}

// The directory a saved parser runs from: the first parser root that holds
// `<name>/parser.py`, so the user's parser shadows ours of the same name.
// `null` when no root has it.
export async function parserDirectory(
  parserName: string,
  projectRoot?: string,
): Promise<string | null> {
  for (const root of parserRoots(projectRoot)) {
    const directory = path.join(root, parserName);
    try {
      await access(path.join(directory, "parser.py"));
      return directory;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    }
  }
  return null;
}

async function directoryNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// The saved parsers whose fingerprint lists `inputExtension`, or every saved
// parser when it is omitted, from every parser root. A directory counts only
// when it holds `parser.py` and a `fingerprint.md` with an
// `**Input extensions:**` line; a shadowed parser's fingerprint is not read.
export async function savedCustomStatementParserNames(
  inputExtension?: string,
): Promise<string[]> {
  const names = new Set(
    (await Promise.all(parserRoots().map(directoryNames))).flat(),
  );
  const parserNames = await Promise.all(
    Array.from(names, async (name) => {
      const directory = await parserDirectory(name);
      if (directory === null) return null;
      let fingerprint: string;
      try {
        fingerprint = await readFile(
          path.join(directory, "fingerprint.md"),
          "utf8",
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      const extensionLine = fingerprint.match(
        /^\*\*Input extensions:\*\*\s*(.+)$/m,
      );
      const extensions = Array.from(
        extensionLine?.[1].matchAll(/`(\.[a-z0-9]+)`/gi) ?? [],
        (match) => match[1].toLowerCase(),
      );
      if (extensions.length === 0) return null;
      if (
        inputExtension !== undefined &&
        !extensions.includes(inputExtension.toLowerCase())
      ) {
        return null;
      }
      return name;
    }),
  );
  return parserNames.filter((name): name is string => name !== null).sort();
}

/** One upload: the name the user dropped it under, and where its copy is. */
export interface StatementUpload {
  name: string;
  path: string;
}

/**
 * Every upload against the saved parsers for its file type, all at once:
 * `parserSlots` bounds how many parsers run together.
 */
export async function recognizeStatementFiles(
  uploads: readonly StatementUpload[],
): Promise<(StatementRecognition & { file: string })[]> {
  return Promise.all(
    uploads.map(async (upload) => {
      const candidates = await savedCustomStatementParserNames(
        path.extname(upload.path),
      );
      return {
        ...(await recognizeStatementFile(candidates, upload.path)),
        file: upload.name,
      };
    }),
  );
}

export async function recognizeStatementFile(
  parserNames: string[],
  inputPath: string,
): Promise<StatementRecognition> {
  const key = await recognitionKey(parserNames, inputPath);
  const known = recognized.get(key);
  if (known !== undefined) {
    return { outcome: "recognized", ...structuredClone(known) };
  }

  // Each parser reads its own copy, since each writes its statement beside
  // its input, under the same name. The matches keep the parsers' order.
  const readings = await Promise.all(
    parserNames.map((parserName) =>
      parserSlots(() =>
        withPrivateCopy(inputPath, async (copy) => {
          try {
            return { parserName, statement: await runParser(parserName, copy) };
          } catch (err) {
            if (!(err instanceof ParserRejectedFile)) throw err;
            return null;
          }
        }),
      ),
    ),
  );
  const matches = readings.filter((one) => one !== null);

  if (matches.length === 1) remember(key, matches[0]);
  if (matches.length === 0) {
    return { outcome: "unrecognized", candidateParserNames: parserNames };
  }
  if (matches.length > 1) {
    return {
      outcome: "ambiguous",
      matchingParserNames: matches.map((match) => match.parserName),
    };
  }
  const [match] = matches;
  console.log(
    `[statement-recognition] ${match.parserName} recognized ${path.basename(inputPath)}`,
  );
  return { outcome: "recognized", ...match };
}

/*
 * A parser is a `uv run` of its own, so a file read when it was dropped is
 * not read again when it is imported a minute later: a recognized file is
 * kept by its contents and the candidate parsers' scripts, so a parser
 * rewritten since reads it afresh. A file no parser claimed is never
 * kept, since setting up its format is what comes next.
 */
interface Recognized {
  parserName: string;
  statement: AbacusStatement;
}

const RECOGNIZED_KEPT = 64;
const recognized = new Map<string, Recognized>();

function remember(key: string, match: Recognized): void {
  recognized.delete(key);
  recognized.set(key, structuredClone(match));
  if (recognized.size > RECOGNIZED_KEPT) {
    recognized.delete(recognized.keys().next().value!);
  }
}

async function recognitionKey(
  parserNames: readonly string[],
  inputPath: string,
): Promise<string> {
  const contents = createHash("sha256")
    .update(await readFile(inputPath))
    .digest("hex");
  const scripts = await Promise.all(
    parserNames.map(async (name) => {
      const directory = await parserDirectory(name);
      const script =
        directory === null
          ? null
          : await readFile(path.join(directory, "parser.py")).catch(() => null);
      return `${name}:${script === null ? "-" : createHash("sha256").update(script).digest("hex")}`;
    }),
  );
  return [path.extname(inputPath).toLowerCase(), contents, ...scripts].join(
    "\n",
  );
}

// At most one parser per core runs at once, across every upload being read.
const parserSlots = slots(Math.max(2, availableParallelism()));

function slots(size: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function <T>(work: () => Promise<T>): Promise<T> {
    // A finished run hands its slot straight to the next in line.
    if (running >= size) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running += 1;
    }
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}

/*
 * A parser writes its statement beside its input, as `<name>.abacus.json`.
 * Two readings of one file at once (the step's page loading while its upload
 * is read, say) would then write and delete each other's output, so each
 * reading runs over its own copy of the file, under the same name, in a
 * directory of its own inside the project's upload staging area. The copy and
 * what the parsers wrote go when the reading ends.
 */
async function withPrivateCopy<T>(
  inputPath: string,
  read: (copy: string) => Promise<T>,
): Promise<T> {
  await mkdir(uploadStagingDir(), { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(uploadStagingDir(), ".reading-"));
  try {
    const copy = path.join(dir, path.basename(inputPath));
    await copyFile(inputPath, copy);
    return await read(copy);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runParser(
  parserName: string,
  inputPath: string,
): Promise<AbacusStatement> {
  const parsed = path.parse(inputPath);
  const jsonPath = path.join(parsed.dir, `${parsed.name}.abacus.json`);
  await unlink(jsonPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });
  await spawnParser(parserName, inputPath);

  let jsonText: string;
  try {
    jsonText = await readFile(jsonPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ParserRejectedFile(
        `${parserName} exited successfully but did not write ${path.basename(jsonPath)}.`,
      );
    }
    throw err;
  }

  try {
    return parseAbacusJson(jsonText, `${parserName} ${parsed.base}`);
  } catch (err) {
    if (err instanceof AbacusJsonParseError) {
      throw new ParserRejectedFile(
        `${parserName} wrote an invalid Abacus JSON document: ${err.detail}`,
      );
    }
    throw err;
  }
}

/**
 * The environment a parser, or a parser's tests, run in. PYTHONPATH names our
 * custom-built-parsers/, so `from shared import abacus` resolves to the
 * bundled package whichever root the parser lives in.
 */
export function parserProcessEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: [packageParsersDir(), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter),
    UV_CACHE_DIR:
      process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "dbu6-uv-cache"),
  };
}

async function spawnParser(
  parserName: string,
  inputPath: string,
): Promise<void> {
  const directory = await parserDirectory(parserName);
  if (directory === null) {
    throw new ParserRejectedFile(`There is no saved parser ${parserName}.`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      "uv",
      ["run", path.join(directory, "parser.py"), inputPath],
      {
        cwd: projectRoot(),
        env: parserProcessEnv(),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) =>
      reject(
        new ParserRejectedFile(`Could not start ${parserName}: ${err.message}`),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new ParserRejectedFile(
            `${parserName} exited with code ${code}. stderr: ${stderr.trim() || "(empty)"}`,
          ),
        );
      }
    });
  });
}
