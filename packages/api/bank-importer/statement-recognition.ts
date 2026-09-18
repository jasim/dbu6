import { spawn } from "node:child_process";
import { readFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectPath } from "@sapporta/server";
import {
  parseAbacusJson,
  type AbacusStatement,
  AbacusJsonParseError,
} from "../modules/statement/index.js";

// Recognizing an uploaded statement with the saved parsers under
// custom-built-parsers/. A parser is its own executable fingerprint: it writes
// `<input>.abacus.json` only for a layout it fully accepts, so a parser that
// exits cleanly with a valid statement has recognized the file.

// What running every candidate parser over one upload established. Exactly
// one parser must claim the file; zero or several leave it unimportable.
export type StatementRecognition =
  | {
      outcome: "recognized";
      // As presets declare it, e.g. `custom-built-parsers/hdfc-cc-xls/parser.py`.
      parserPath: string;
      statement: AbacusStatement;
    }
  | { outcome: "unrecognized"; candidateParserPaths: string[] }
  | { outcome: "ambiguous"; matchingParserPaths: string[] };

// A parser that exits non-zero, writes nothing, or writes an invalid
// statement has not recognized the file.
class ParserRejectedFile extends Error {}

// The saved parsers whose fingerprint lists `inputExtension`, or every saved
// parser when it is omitted. A directory counts only when it holds `parser.py`
// and a `fingerprint.md` with an `**Input extensions:**` line.
export async function savedCustomStatementParserPaths(
  inputExtension?: string,
): Promise<string[]> {
  const root = projectPath("custom-built-parsers");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const parserPaths = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry) => {
        const directory = path.join(root, entry.name);
        try {
          const fingerprint = await readFile(
            path.join(directory, "fingerprint.md"),
            "utf8",
          );
          await readFile(path.join(directory, "parser.py"), "utf8");
          if (fingerprint.trim() === "") return null;
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
          return path.posix.join(
            "custom-built-parsers",
            entry.name,
            "parser.py",
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw err;
        }
      }),
  );
  return parserPaths
    .filter((parserPath): parserPath is string => parserPath !== null)
    .sort();
}

export async function recognizeStatementFile(
  parserPaths: string[],
  inputPath: string,
): Promise<StatementRecognition> {
  const matches: { parserPath: string; statement: AbacusStatement }[] = [];
  for (const parserPath of parserPaths) {
    try {
      matches.push({
        parserPath,
        statement: await runParser(parserPath, inputPath),
      });
    } catch (err) {
      if (!(err instanceof ParserRejectedFile)) throw err;
    }
  }

  if (matches.length === 0) {
    return { outcome: "unrecognized", candidateParserPaths: parserPaths };
  }
  if (matches.length > 1) {
    return {
      outcome: "ambiguous",
      matchingParserPaths: matches.map((match) => match.parserPath),
    };
  }
  const [match] = matches;
  console.log(
    `[statement-recognition] ${match.parserPath} recognized ${path.basename(inputPath)}`,
  );
  return { outcome: "recognized", ...match };
}

async function runParser(
  parserPath: string,
  inputPath: string,
): Promise<AbacusStatement> {
  const parsed = path.parse(inputPath);
  const jsonPath = path.join(parsed.dir, `${parsed.name}.abacus.json`);
  await unlink(jsonPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });
  await spawnParser(parserPath, inputPath);

  let jsonText: string;
  try {
    jsonText = await readFile(jsonPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ParserRejectedFile(
        `${parserPath} exited successfully but did not write ${path.basename(jsonPath)}.`,
      );
    }
    throw err;
  }

  try {
    return parseAbacusJson(jsonText, `${parserPath} ${parsed.base}`);
  } catch (err) {
    if (err instanceof AbacusJsonParseError) {
      throw new ParserRejectedFile(
        `${parserPath} wrote an invalid Abacus JSON document: ${err.detail}`,
      );
    }
    throw err;
  }
}

function spawnParser(parserPath: string, inputPath: string): Promise<void> {
  const executable = path.isAbsolute(parserPath)
    ? parserPath
    : projectPath(parserPath);
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", executable, inputPath], {
      cwd: projectPath("."),
      env: {
        ...process.env,
        UV_CACHE_DIR:
          process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "dbu6-uv-cache"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) =>
      reject(
        new ParserRejectedFile(`Could not start ${parserPath}: ${err.message}`),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new ParserRejectedFile(
            `${parserPath} exited with code ${code}. stderr: ${stderr.trim() || "(empty)"}`,
          ),
        );
      }
    });
  });
}
