#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Move files or folders inside packages/api and rewrite every relative import
// of them, so a move is one command:
//
//   node scripts/move-files.mjs <from> <to> [<from> <to> …] [--dry-run]
//
// Paths are relative to packages/api; each pair is a file or a directory, and
// the pairs apply in order. The TypeScript language service's
// getEditsForFileRename rewrites imports in every .ts file of the package,
// tests included, both in files that import the moved ones and inside the moved
// files. vitest's vi.mock-style calls name modules by path too, but TypeScript
// doesn't see them as imports, so they are rewritten here. The moves happen in
// memory first, so --dry-run shows the edits of the whole sequence without
// touching anything. A real run then `git mv`s, writes the edited files, and
// runs Prettier on them.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const apiRoot = path.join(projectRoot, "packages/api");
const ts = createRequire(path.join(apiRoot, "package.json"))("typescript");

// Folders that hold no source of ours; the layering test skips the same ones.
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "migrations"]);
const VITEST_PATH_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const paths = args.filter((arg) => arg !== "--dry-run");
if (paths.length === 0 || paths.length % 2 !== 0) {
  console.error(
    "usage: node scripts/move-files.mjs <from> <to> [<from> <to> …] [--dry-run]\n" +
      "Paths are relative to packages/api.",
  );
  process.exit(1);
}
const pairs = [];
for (let i = 0; i < paths.length; i += 2) {
  pairs.push({ from: apiPath(paths[i]), to: apiPath(paths[i + 1]) });
}

// ---------------------------------------------------------------------------
// The package's .ts files, held in memory while the moves are planned.

const files = new Map(); // current path -> { text, version, originalText }
for (const file of sourceFiles(apiRoot)) {
  const text = readFileSync(file, "utf8");
  files.set(file, { text, version: 0, originalText: text });
}
let version = 0;

const service = ts.createLanguageService(
  languageServiceHost(),
  ts.createDocumentRegistry(),
);
const moves = [];
for (const [index, { from, to }] of pairs.entries()) {
  const overlaps = (a, b) =>
    a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  if (
    pairs
      .slice(0, index)
      .some((p) => overlaps(from, p.from) || overlaps(from, p.to))
  ) {
    fail(
      `${api(from)} is moved by an earlier pair; run it as a separate command`,
    );
  }
  const kind = checkMove(from, to);
  const moved = (file) => {
    if (kind === "file") return file === from ? to : file;
    return file.startsWith(`${from}/`) ? to + file.slice(from.length) : file;
  };

  applyEdits(
    service.getEditsForFileRename(from, to, ts.getDefaultFormatCodeSettings(), {
      importModuleSpecifierPreference: "relative",
      importModuleSpecifierEnding: "js",
    }),
  );
  applyEdits(vitestPathEdits(moved));

  for (const [file, entry] of [...files]) {
    const target = moved(file);
    if (target === file) continue;
    files.delete(file);
    files.set(target, { ...entry, version: ++version });
  }
  moves.push({ from: api(from), to: api(to) });
}

const changed = [...files]
  .filter(([, entry]) => entry.text !== entry.originalText)
  .map(([file, entry]) => ({ file, ...entry }));

for (const move of moves) console.log(`git mv ${move.from} ${move.to}`);

if (dryRun) {
  for (const { file, text, originalText } of changed) {
    console.log(`\n${api(file)}`);
    printChangedLines(originalText, text);
  }
  printSiblingsLeftBehind();
  console.log(
    "\nDry run: nothing moved or written. Prettier runs after a real move.",
  );
  process.exit(0);
}

for (const move of moves) {
  mkdirSync(path.dirname(path.join(apiRoot, move.to)), { recursive: true });
  execFileSync("git", ["mv", move.from, move.to], {
    cwd: apiRoot,
    stdio: "inherit",
  });
  // git leaves the folders it empties behind.
  let emptied = path.dirname(path.join(apiRoot, move.from));
  while (emptied !== apiRoot && readdirSync(emptied).length === 0) {
    rmdirSync(emptied);
    emptied = path.dirname(emptied);
  }
}
for (const { file, text } of changed) writeFileSync(file, text);
if (changed.length > 0) {
  execFileSync(
    path.join(projectRoot, "node_modules/.bin/prettier"),
    ["--write", "--log-level=warn", ...changed.map(({ file }) => file)],
    { cwd: projectRoot, stdio: "inherit" },
  );
}
console.log(`\nRewrote imports in ${changed.length} file(s):`);
for (const { file } of changed) console.log(`  ${api(file)}`);
printSiblingsLeftBehind();
printMentionsLeft();

// ---------------------------------------------------------------------------

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")
        ? []
        : sourceFiles(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function apiPath(argument) {
  const full = path.resolve(apiRoot, argument).replace(/\/+$/, "");
  const inside = path.relative(apiRoot, full);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    fail(`${argument} is not inside packages/api`);
  }
  if (SKIPPED_DIRECTORIES.has(inside.split(path.sep)[0])) {
    fail(`${argument} is in a folder this tool doesn't manage`);
  }
  return full;
}

function api(file) {
  return path.relative(apiRoot, file);
}

function fail(message) {
  console.error(`move-files: ${message}`);
  process.exit(1);
}

// Whether `from` is a file or a directory, once the move is known to be safe.
// Earlier pairs count: they have already happened in memory.
function checkMove(from, to) {
  const holdsSource = (directory) =>
    [...files.keys()].some((file) => file.startsWith(`${directory}/`));
  const onDisk = existsSync(from) ? statSync(from) : null;
  let kind;
  if (files.has(from) || onDisk?.isFile()) kind = "file";
  else if (holdsSource(from) || onDisk?.isDirectory()) kind = "directory";
  else fail(`${api(from)} doesn't exist`);
  if (files.has(to) || holdsSource(to) || existsSync(to)) {
    fail(`${api(to)} already exists`);
  }
  if (kind === "directory" && to.startsWith(`${from}/`)) {
    fail(`can't move ${api(from)} into itself`);
  }
  if (onDisk !== null) {
    const tracked = execFileSync("git", ["ls-files", "--", api(from)], {
      cwd: apiRoot,
      encoding: "utf8",
    });
    if (tracked.trim() === "") fail(`${api(from)} isn't tracked by git`);
  }
  return kind;
}

function languageServiceHost() {
  const { config, error } = ts.readConfigFile(
    path.join(apiRoot, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (error) fail(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, apiRoot);

  // Our .ts files answer from memory; everything else (package.json files,
  // node_modules, TypeScript's libs) from disk.
  const ours = (file) =>
    file.endsWith(".ts") &&
    file.startsWith(`${apiRoot}/`) &&
    !SKIPPED_DIRECTORIES.has(api(file).split(path.sep)[0]);
  const readFile = (file) =>
    ours(file) ? files.get(file)?.text : ts.sys.readFile(file);

  return {
    getCompilationSettings: () => options,
    // Without it the service re-checks every file's version on each lookup.
    getProjectVersion: () => String(version),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (file) => String(files.get(file)?.version ?? 0),
    getScriptSnapshot: (file) => {
      const text = readFile(file);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => apiRoot,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (file) =>
      ours(file) ? files.has(file) : ts.sys.fileExists(file),
    readFile,
    directoryExists: (directory) =>
      ts.sys.directoryExists(directory) ||
      [...files.keys()].some((file) => file.startsWith(`${directory}/`)),
    getDirectories: (directory) => ts.sys.getDirectories(directory),
    realpath: (file) => (ours(file) ? file : ts.sys.realpath(file)),
  };
}

function applyEdits(fileChanges) {
  for (const { fileName, textChanges } of fileChanges) {
    const entry = files.get(fileName);
    if (entry === undefined) {
      console.warn(
        `move-files: skipped edits to ${fileName}, which it doesn't manage`,
      );
      continue;
    }
    let text = entry.text;
    for (const { span, newText } of [...textChanges].sort(
      (a, b) => b.span.start - a.span.start,
    )) {
      text =
        text.slice(0, span.start) +
        newText +
        text.slice(span.start + span.length);
    }
    if (text !== entry.text) {
      files.set(fileName, { ...entry, text, version: ++version });
    }
  }
}

// Edits for vi.mock("./x.js") and its siblings whose file or target moves.
function vitestPathEdits(moved) {
  const edits = [];
  for (const [file, { text }] of files) {
    if (!text.includes("vi.")) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const textChanges = [];
    const visit = (node) => {
      const specifier = vitestPathArgument(node);
      if (specifier !== undefined) {
        const target = resolveSpecifier(file, specifier.text);
        if (target !== undefined) {
          const rewritten = specifierFor(moved(file), {
            ...target,
            file: moved(target.file),
          });
          if (rewritten !== specifier.text) {
            textChanges.push({
              span: {
                start: specifier.getStart() + 1,
                length: specifier.text.length,
              },
              newText: rewritten,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (textChanges.length > 0) edits.push({ fileName: file, textChanges });
  }
  return edits;
}

function vitestPathArgument(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const [first] = node.arguments;
  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "vi" &&
    VITEST_PATH_CALLS.has(callee.name.text) &&
    first !== undefined &&
    ts.isStringLiteralLike(first) &&
    first.text.startsWith(".")
    ? first
    : undefined;
}

// The .ts file a relative specifier names, and how the specifier spells it:
// "./x.js" and "./x/index.js" as "js", "./x" as "bare", a folder's index as
// "folder".
function resolveSpecifier(file, specifier) {
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = [
    ...(base.endsWith(".js")
      ? [{ file: base.replace(/\.js$/, ".ts"), spelling: "js" }]
      : []),
    { file: `${base}.ts`, spelling: "bare" },
    { file: path.join(base, "index.ts"), spelling: "folder" },
  ];
  return candidates.find((candidate) => files.has(candidate.file));
}

function specifierFor(fromFile, target) {
  const spelled = {
    js: () => target.file.replace(/\.ts$/, ".js"),
    bare: () => target.file.replace(/\.ts$/, ""),
    folder: () => path.dirname(target.file),
  }[target.spelling]();
  const relative = path
    .relative(path.dirname(fromFile), spelled)
    .split(path.sep)
    .join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function printChangedLines(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  if (oldLines.length !== newLines.length) {
    console.log("  (rewritten)");
    return;
  }
  oldLines.forEach((line, i) => {
    if (line === newLines[i]) return;
    console.log(`  ${i + 1} - ${line.trim()}`);
    console.log(
      `  ${" ".repeat(String(i + 1).length)} + ${newLines[i].trim()}`,
    );
  });
}

// A moved file's tests (x.test.ts, x.assembly.test.ts) that stayed where it was.
function printSiblingsLeftBehind() {
  const left = pairs.flatMap(({ from }) => {
    if (!from.endsWith(".ts")) return [];
    const stem = `${from.slice(0, -".ts".length)}.`;
    return [...files.keys()].filter((file) => file.startsWith(stem));
  });
  if (left.length === 0) return;
  console.log(
    "\nLeft behind beside a moved file (move them too if they belong to it):",
  );
  for (const file of left) console.log(`  ${api(file)}`);
}

// Text that still names an old path: the layering test's table, docs, prompts.
function printMentionsLeft() {
  const lines = pairs.flatMap(({ from }) => {
    const mention = api(from).replace(/\.ts$/, "");
    try {
      return execFileSync(
        "git",
        ["grep", "-n", "-F", mention, "--", ".", ":(exclude)PLAN.md"],
        { cwd: projectRoot, encoding: "utf8" },
      )
        .trim()
        .split("\n");
    } catch {
      return []; // git grep exits 1 when nothing matches
    }
  });
  if (lines.length === 0) return;
  console.log("\nStill naming an old path (update where it matters):");
  for (const line of lines) console.log(`  ${line}`);
}
