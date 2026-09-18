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

// Move code inside packages/api and rewrite every relative import of it, so a
// move is one command. Paths are relative to packages/api.
//
//   node scripts/move-files.mjs <from> <to> [<from> <to> …] [--dry-run]
//
// Moves files or folders; each pair is a file or a directory, and the pairs
// apply in order. The TypeScript language service's getEditsForFileRename
// rewrites imports in every .ts file of the package, tests included, both in
// files that import the moved ones and inside the moved files. vitest's
// vi.mock-style calls name modules by path too, but TypeScript doesn't see them
// as imports, so they are rewritten here.
//
//   node scripts/move-files.mjs --symbols <file> <name>[,<name>…] <to> [--dry-run]
//
// Moves top-level declarations out of a file into another, created if it
// doesn't exist, with TypeScript's "Move to file" refactor, which rewrites
// every import of them.
//
//   node scripts/move-files.mjs --through <folder> [--dry-run]
//
// Makes every file outside the folder import its files through its index.ts.
//
// Each form then merges imports that now name the same module twice. The work
// happens in memory first, so --dry-run shows the edits, and the TypeScript
// errors they would leave, without touching anything. A real run then
// `git mv`s (or `git add`s a created file), writes the edited files, and runs
// Prettier on them.

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const apiRoot = path.join(projectRoot, "packages/api");
const ts = createRequire(path.join(apiRoot, "package.json"))("typescript");

// Folders that hold no source of ours.
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "migrations"]);
const VITEST_PATH_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);
const FORMAT_SETTINGS = {
  ...ts.getDefaultFormatCodeSettings(),
  indentSize: 2,
  tabSize: 2,
};
const PREFERENCES = {
  importModuleSpecifierPreference: "relative",
  importModuleSpecifierEnding: "js",
  preferTypeOnlyAutoImports: true,
  quotePreference: "double",
  allowTextChangesInNewFiles: true,
};
const USAGE =
  "usage: node scripts/move-files.mjs <from> <to> [<from> <to> …] [--dry-run]\n" +
  "       node scripts/move-files.mjs --symbols <file> <name>[,<name>…] <to> [--dry-run]\n" +
  "       node scripts/move-files.mjs --through <folder> [--dry-run]\n" +
  "Paths are relative to packages/api.";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const command = parseCommand(args.filter((arg) => arg !== "--dry-run"));

// ---------------------------------------------------------------------------
// The package's .ts files, held in memory while the edits are planned.

// current path -> { text, version, originalText, created? }
const files = new Map();
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
if (command.kind === "files") moveFiles(command.pairs);
if (command.kind === "symbols") moveSymbols(command);
if (command.kind === "through") routeThrough(command.folder);
mergeDuplicateImports();

const changed = [...files]
  .filter(([, entry]) => entry.text !== entry.originalText)
  .map(([file, entry]) => ({ file, ...entry }));
const errors = typeErrors(changed.map(({ file }) => file));

for (const move of moves) console.log(`git mv ${move.from} ${move.to}`);

if (dryRun) {
  for (const { file, text, originalText, created } of changed) {
    console.log(`\n${api(file)}${created ? " (new)" : ""}`);
    printChangedLines(originalText, text);
  }
  printLeftovers();
  printTypeErrors(errors);
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
for (const { file, text } of changed) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
const created = changed.filter((entry) => entry.created);
if (created.length > 0) {
  execFileSync("git", ["add", "--", ...created.map(({ file }) => api(file))], {
    cwd: apiRoot,
    stdio: "inherit",
  });
}
if (changed.length > 0) {
  execFileSync(
    path.join(projectRoot, "node_modules/.bin/prettier"),
    ["--write", "--log-level=warn", ...changed.map(({ file }) => file)],
    { cwd: projectRoot, stdio: "inherit" },
  );
}
console.log(`\nEdited ${changed.length} file(s):`);
for (const { file, created } of changed) {
  console.log(`  ${api(file)}${created ? " (new)" : ""}`);
}
printLeftovers();
printMentionsLeft();
printTypeErrors(errors);

// ---------------------------------------------------------------------------
// The three forms.

function parseCommand(operands) {
  const usage = () => {
    console.error(USAGE);
    process.exit(1);
  };
  if (operands[0] === "--symbols") {
    if (operands.length !== 4) usage();
    const [, from, names, to] = operands;
    return {
      kind: "symbols",
      from: apiPath(from),
      names: names.split(",").filter((name) => name !== ""),
      to: apiPath(to),
    };
  }
  if (operands[0] === "--through") {
    if (operands.length !== 2) usage();
    return { kind: "through", folder: apiPath(operands[1]) };
  }
  if (operands.length === 0 || operands.length % 2 !== 0) usage();
  if (operands.some((operand) => operand.startsWith("--"))) usage();
  const pairs = [];
  for (let i = 0; i < operands.length; i += 2) {
    pairs.push({ from: apiPath(operands[i]), to: apiPath(operands[i + 1]) });
  }
  return { kind: "files", pairs };
}

function moveFiles(pairs) {
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
      service.getEditsForFileRename(from, to, FORMAT_SETTINGS, PREFERENCES),
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
}

// Each name moves on its own, with the statements that declare it (all of a
// function's overloads), and keeps a comment that sat directly above it.
function moveSymbols({ from, names, to }) {
  if (!files.has(from)) fail(`${api(from)} isn't a .ts file of packages/api`);
  if (!to.endsWith(".ts") || to.endsWith(".d.ts")) {
    fail(`${api(to)} isn't a .ts file`);
  }
  if (to === from) fail("the file to move into is the file to move from");
  if (names.length === 0) fail("name at least one declaration to move");
  if (!files.has(to)) {
    if (existsSync(to)) fail(`${api(to)} exists but isn't a source file`);
    files.set(to, { text: "", version: ++version, originalText: "" });
    files.get(to).created = true;
  }
  for (const name of names) {
    const source = service.getProgram().getSourceFile(from);
    const statements = source.statements.filter((statement) =>
      declaredNames(statement).includes(name),
    );
    if (statements.length === 0) {
      fail(`${api(from)} has no top-level declaration of ${name}`);
    }
    const first = statements[0];
    const last = statements.at(-1);
    const spanned = source.statements.slice(
      source.statements.indexOf(first),
      source.statements.indexOf(last) + 1,
    );
    const others = spanned.flatMap(declaredNames).filter((n) => n !== name);
    if (spanned.length !== statements.length || others.length > 0) {
      fail(
        `${name} shares its statements with other declarations (${others.join(", ")}); move them apart first`,
      );
    }
    const comment = attachedComment(source, first);
    const refactor = service.getEditsForRefactor(
      from,
      FORMAT_SETTINGS,
      { pos: first.getStart(source), end: last.end },
      "Move to file",
      "Move to file",
      PREFERENCES,
      { targetFile: to },
    );
    if (refactor === undefined) {
      fail(`TypeScript can't move ${name} to ${api(to)}`);
    }
    applyEdits(refactor.edits);
    // The refactor puts a blank line between a moved comment and its
    // declaration, and none between the declaration and what comes before it.
    if (comment !== undefined) {
      const { text } = files.get(to);
      setText(to, text.replace(`${comment}\n\n`, `${comment}\n`));
    }
    separateFromPrevious(to, name);
  }
}

function separateFromPrevious(file, name) {
  const { text } = files.get(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const index = source.statements.findIndex((statement) =>
    declaredNames(statement).includes(name),
  );
  if (index <= 0) return;
  const previous = source.statements[index - 1];
  const between = text.slice(
    previous.end,
    source.statements[index].getStart(source),
  );
  if (/\n[ \t]*\n/.test(between)) return;
  setText(file, `${text.slice(0, previous.end)}\n${text.slice(previous.end)}`);
}

function declaredNames(statement) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  }
  const name = statement.name;
  return name !== undefined && ts.isIdentifier(name) ? [name.text] : [];
}

// The comment right above a statement, with no blank line between them.
function attachedComment(source, statement) {
  const ranges =
    ts.getLeadingCommentRanges(source.text, statement.getFullStart()) ?? [];
  const last = ranges.at(-1);
  if (last === undefined) return undefined;
  const gap = source.text.slice(last.end, statement.getStart(source));
  return /\n\s*\n/.test(gap)
    ? undefined
    : source.text.slice(last.pos, last.end);
}

// Imports, re-exports, import() calls and import("…") types from outside the
// folder that name a file inside it other than its index.ts now name the
// index. vi.mock-style paths are left alone: mocking the index is a different
// test.
function routeThrough(folder) {
  const entry = path.join(folder, "index.ts");
  if (!files.has(entry)) fail(`${api(folder)} has no index.ts`);
  const inside = (file) => file.startsWith(`${folder}/`);
  const mocked = [];
  for (const [file, { text }] of [...files]) {
    if (inside(file)) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const textChanges = [];
    const visit = (node) => {
      const specifier = importSpecifierOf(node);
      if (specifier !== undefined && specifier.text.startsWith(".")) {
        const target = resolveSpecifier(file, specifier.text);
        if (target !== undefined && inside(target.file)) {
          if (target.file !== entry) {
            textChanges.push({
              span: {
                start: specifier.getStart() + 1,
                length: specifier.text.length,
              },
              newText: specifierFor(file, { file: entry, spelling: "js" }),
            });
          }
        }
      }
      const mock = vitestPathArgument(node);
      if (mock !== undefined) {
        const target = resolveSpecifier(file, mock.text);
        if (target !== undefined && inside(target.file)) {
          mocked.push(
            `${api(file)}: vi.${node.expression.name.text}("${mock.text}")`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    applyEdits([{ fileName: file, textChanges }]);
  }
  if (mocked.length > 0) {
    console.log(`\nMocks of files inside ${api(folder)}, left as they are:`);
    for (const line of mocked) console.log(`  ${line}`);
  }
}

function importSpecifierOf(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0];
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteral(node.argument.literal)
  ) {
    return node.argument.literal;
  }
  return undefined;
}

// In every edited file, an import that repeats an earlier one word for word
// goes, and named imports of one of our modules spread over several
// declarations become one: `import type { A, B }` when every name is a type,
// otherwise `import { a, type B }`. Other package imports are left as they
// are.
function mergeDuplicateImports() {
  for (const [file, { text, originalText }] of [...files]) {
    if (text === originalText) continue;
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const bySpecifier = new Map();
    const seen = new Set();
    const repeated = [];
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const words = statement.getText(source).replace(/\s+/g, " ");
        if (seen.has(words)) {
          repeated.push(statement);
          continue;
        }
        seen.add(words);
      }
      const clause = ts.isImportDeclaration(statement)
        ? statement.importClause
        : undefined;
      if (
        clause === undefined ||
        clause.name !== undefined ||
        clause.namedBindings === undefined ||
        !ts.isNamedImports(clause.namedBindings)
      ) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      bySpecifier.set(specifier, [
        ...(bySpecifier.get(specifier) ?? []),
        statement,
      ]);
    }
    const textChanges = repeated.map((declaration) =>
      removal(text, declaration),
    );
    for (const [specifier, declarations] of bySpecifier) {
      const bindings = new Map(); // local name -> { binding, typeOnly }
      for (const declaration of declarations) {
        for (const element of declaration.importClause.namedBindings.elements) {
          const local = element.name.text;
          const typeOnly =
            declaration.importClause.isTypeOnly || element.isTypeOnly;
          if (bindings.has(local) && !bindings.get(local).typeOnly) continue;
          const binding =
            element.propertyName === undefined
              ? local
              : `${element.propertyName.text} as ${local}`;
          bindings.set(local, { binding, typeOnly });
        }
      }
      const allTypes = [...bindings.values()].every(({ typeOnly }) => typeOnly);
      const [only] = declarations;
      if (
        declarations.length === 1 &&
        (only.importClause.isTypeOnly || !allTypes)
      ) {
        continue;
      }
      const elements = [...bindings.values()].map(({ binding, typeOnly }) =>
        typeOnly && !allTypes ? `type ${binding}` : binding,
      );
      const [first, ...rest] = declarations;
      textChanges.push({
        span: { start: first.getStart(), length: first.end - first.getStart() },
        newText: `import ${allTypes ? "type " : ""}{ ${elements.join(", ")} } from "${specifier}";`,
      });
      for (const declaration of rest) {
        textChanges.push(removal(text, declaration));
      }
    }
    applyEdits([{ fileName: file, textChanges }]);
  }
}

// An edit deleting a statement; its leading line break goes with it, unless a
// comment sits there.
function removal(text, statement) {
  const start =
    text.slice(statement.getFullStart(), statement.getStart()).trim() === ""
      ? statement.getFullStart()
      : statement.getStart();
  return { span: { start, length: statement.end - start }, newText: "" };
}

function typeErrors(changedFiles) {
  return changedFiles.flatMap((file) =>
    [
      ...service.getSyntacticDiagnostics(file),
      ...service.getSemanticDiagnostics(file),
    ].map((diagnostic) => {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      return `${api(file)}:${line + 1}: ${message}`;
    }),
  );
}

function printTypeErrors(errors) {
  if (errors.length === 0) return;
  console.log("\nTypeScript errors in the edited files (fix them next):");
  for (const error of errors) console.log(`  ${error}`);
}

function setText(file, text) {
  const entry = files.get(file);
  if (entry.text !== text)
    files.set(file, { ...entry, text, version: ++version });
}

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

// The lines an edit removes and adds, by a longest-common-subsequence diff.
function printChangedLines(before, after) {
  const old = before === "" ? [] : before.split("\n");
  const now = after.split("\n");
  const common = Array.from(
    { length: old.length + 1 },
    () => new Uint32Array(now.length + 1),
  );
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) {
      common[i][j] =
        old[i] === now[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < old.length || j < now.length) {
    if (i < old.length && j < now.length && old[i] === now[j]) {
      i++;
      j++;
    } else if (
      j < now.length &&
      (i === old.length || common[i][j + 1] >= common[i + 1][j])
    ) {
      console.log(`  ${j + 1} + ${now[j].trim()}`);
      j++;
    } else {
      console.log(`  ${i + 1} - ${old[i].trim()}`);
      i++;
    }
  }
}

// A moved file's tests (x.test.ts, x.assembly.test.ts) that stayed where it was.
function printLeftovers() {
  if (command.kind !== "files") return;
  const left = command.pairs.flatMap(({ from }) => {
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

// Text that still names what moved: an old path (docs, prompts), or a moved
// name outside the package's code.
function printMentionsLeft() {
  const searches =
    command.kind === "files"
      ? command.pairs.map(({ from }) => ({
          options: ["-F"],
          needle: api(from).replace(/\.ts$/, ""),
          scope: [],
        }))
      : command.kind === "symbols"
        ? command.names.map((name) => ({
            options: ["-w", "-F"],
            needle: name,
            scope: [":(exclude,glob)packages/api/**/*.ts"],
          }))
        : [];
  const lines = searches.flatMap(({ options, needle, scope }) => {
    try {
      return execFileSync(
        "git",
        [
          "grep",
          "-n",
          ...options,
          needle,
          "--",
          ".",
          ":(exclude)PLAN.md",
          ...scope,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      )
        .trim()
        .split("\n");
    } catch {
      return []; // git grep exits 1 when nothing matches
    }
  });
  if (lines.length === 0) return;
  console.log("\nStill naming what moved (update where it matters):");
  for (const line of lines) console.log(`  ${line}`);
}
