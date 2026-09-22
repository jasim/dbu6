import { spawn } from "node:child_process";
import { access, readFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseAbacusJson,
  type AbacusStatement,
  AbacusJsonParseError,
} from "../statement/index.js";
import { packageParsersDir, parserRoots, projectRoot } from "../../paths.js";

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
export async function parserDirectory(parserName: string): Promise<string | null> {
  for (const root of parserRoots()) {
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

export async function recognizeStatementFile(
  parserNames: string[],
  inputPath: string,
): Promise<StatementRecognition> {
  const matches: { parserName: string; statement: AbacusStatement }[] = [];
  for (const parserName of parserNames) {
    try {
      matches.push({
        parserName,
        statement: await runParser(parserName, inputPath),
      });
    } catch (err) {
      if (!(err instanceof ParserRejectedFile)) throw err;
    }
  }

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
