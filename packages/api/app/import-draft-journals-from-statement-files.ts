import { spawn } from "node:child_process";
import { readFile, readdir, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { TsRestApi, projectPath, type SapportaEnv } from "@sapporta/server";
import { userConfigPath } from "../user-data.js";
import {
  importDraftsContract,
  importPresetSchema,
  type ExtractionTool,
} from "dbu6-shared";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  ApiImportError,
  PdfExtractionFailed,
  runAbacusJsonImport,
  runFreeformImport,
  runFreeformSourceImport,
  type ExtractedStatementSource,
} from "../bank-importer/freeform-import.js";
import { abacusJsonSchema } from "../bank-importer/domain/Abacus.js";
import { withTempUploads } from "./upload-tmp.js";
import {
  argsFromMultipartBody,
  optionsFromMultipartBody,
  jsonOptionsFromMultipartBody,
  respondWithImportErrors,
} from "./freeform-args.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const EXTRACTION_TOOLS = [
  "extract-table",
  "pdftotext",
] as const satisfies readonly ExtractionTool[];

function parseExtractionTool(raw: unknown): ExtractionTool {
  if (
    typeof raw === "string" &&
    (EXTRACTION_TOOLS as readonly string[]).includes(raw)
  ) {
    return raw as ExtractionTool;
  }
  return "extract-table";
}

const pdfExtractScript = path.join(
  homedir(),
  "m/a/code/tools/pdf-extract/extract-table-from-pdf.py",
);

const PDF_EXT = ".pdf";
const TEXT_EXTS = new Set([".txt", ".csv"]);
const XLS_EXT = ".xls";
const JSON_EXT = ".json";
const CUSTOM_STATEMENT_PARSER_FIELD = "custom_statement_parser_path";
const AUTO_DETECT_STATEMENT_PARSER_FIELD = "auto_detect_statement_parser";
const importPresetsSchema = z.array(importPresetSchema);

type BatchKind = "pdf" | "text" | "xls" | "json";
type BatchClassification =
  { ok: true; kind: BatchKind } | { ok: false; error: string };

type ImportErrorBody = {
  error: string;
  message?: string;
  detail?: string;
  hint?: string;
} & Record<string, unknown>;

class CustomStatementParserFailed extends ApiImportError {
  readonly status = 422;

  constructor(
    readonly parserPath: string,
    readonly inputPath: string,
    readonly detail: string,
  ) {
    super(`Custom statement parser failed: ${detail}`);
    this.name = "CustomStatementParserFailed";
  }

  toPayload() {
    return {
      error: "custom_statement_parser_failed",
      message:
        "Could not parse the uploaded statement with the selected custom parser.",
      parser_path: this.parserPath,
      input_path: path.basename(this.inputPath),
      detail: this.detail,
    };
  }
}

class CustomStatementParserDetectionFailed extends ApiImportError {
  readonly status = 422;

  constructor(
    readonly inputPath: string,
    readonly matches: string[],
    readonly candidates: string[],
  ) {
    super(
      matches.length === 0
        ? "No saved custom statement parser matched the uploaded file."
        : "More than one saved custom statement parser matched the uploaded file.",
    );
    this.name = "CustomStatementParserDetectionFailed";
  }

  toPayload() {
    const ambiguous = this.matches.length > 1;
    return {
      error: ambiguous
        ? "custom_statement_parser_ambiguous"
        : "custom_statement_parser_not_detected",
      message: this.message,
      input_path: path.basename(this.inputPath),
      ...(ambiguous
        ? { matching_parser_paths: this.matches }
        : { candidate_parser_paths: this.candidates }),
      hint: ambiguous
        ? "Turn off auto-detection and choose a preset with the intended parser."
        : "Turn off auto-detection to use the normal statement extraction path, or add a saved parser for this layout.",
    };
  }
}

class XlsExtractionFailed extends ApiImportError {
  readonly status = 422;

  constructor(readonly detail: string) {
    super(`XLS extraction failed: ${detail}`);
    this.name = "XlsExtractionFailed";
  }

  toPayload() {
    return {
      error: "xls_extraction_failed",
      message: "Could not read the uploaded XLS statement.",
      detail: this.detail,
    };
  }
}

export function classifyBatch(files: File[]): BatchClassification {
  const exts = files.map((f) => path.extname(f.name).toLowerCase());
  const allPdf = exts.every((e) => e === PDF_EXT);
  const allText = exts.every((e) => TEXT_EXTS.has(e));
  const allXls = exts.every((e) => e === XLS_EXT);
  const allJson = exts.every((e) => e === JSON_EXT);
  if (allPdf) return { ok: true, kind: "pdf" };
  if (allText) return { ok: true, kind: "text" };
  if (allXls) return { ok: true, kind: "xls" };
  if (allJson) return { ok: true, kind: "json" };
  return {
    ok: false,
    error:
      "Files must all be PDFs, all be TXT/CSV, all be XLS, or all be JSON; paths cannot be mixed within a single batch.",
  };
}

function customParserPathFromBody(
  body: Record<string, unknown>,
): string | null {
  const raw = body[CUSTOM_STATEMENT_PARSER_FIELD];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw.trim();
}

function autoDetectStatementParserFromBody(
  body: Record<string, unknown>,
): boolean {
  return body[AUTO_DETECT_STATEMENT_PARSER_FIELD] === "true";
}

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

async function configuredCustomStatementParserPaths(): Promise<Set<string>> {
  const file = userConfigPath("import-presets.json");
  try {
    const raw = await readFile(file, "utf8");
    const presets = importPresetsSchema.parse(JSON.parse(raw));
    return new Set(
      presets
        .map((preset) => preset.custom_statement_parser_path)
        .filter((parserPath): parserPath is string => Boolean(parserPath)),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw err;
  }
}

export function resolveCustomStatementParserPath(parserPath: string): string {
  return path.isAbsolute(parserPath) ? parserPath : projectPath(parserPath);
}

export function resolveAllowedCustomStatementParserPath(
  parserPath: string,
  allowedParserPaths: Set<string>,
): string | null {
  if (!allowedParserPaths.has(parserPath)) return null;
  return resolveCustomStatementParserPath(parserPath);
}

function abacusJsonPathForInput(inputPath: string): string {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.abacus.json`);
}

async function runCustomStatementParser(
  parserPath: string,
  inputPath: string,
  quiet = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", parserPath, inputPath], {
      cwd: projectPath("."),
      env: {
        ...process.env,
        UV_CACHE_DIR:
          process.env.UV_CACHE_DIR ?? path.join(tmpdir(), "dbu6-uv-cache"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout?.on("data", (d) => {
      if (!quiet) process.stdout.write(`[custom-statement-parser] ${d}`);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (!quiet) process.stderr.write(`[custom-statement-parser] ${d}`);
    });
    child.on("error", (err) =>
      reject(
        new CustomStatementParserFailed(
          parserPath,
          inputPath,
          `Could not start parser: ${err.message}`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new CustomStatementParserFailed(
            parserPath,
            inputPath,
            `Parser exited with code ${code}. stderr: ${stderr.trim() || "(empty)"}`,
          ),
        );
      }
    });
  });
}

async function readGeneratedAbacusJson(
  parserPath: string,
  inputPath: string,
): Promise<string> {
  const jsonPath = abacusJsonPathForInput(inputPath);
  let jsonText: string;
  try {
    jsonText = await readFile(jsonPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CustomStatementParserFailed(
        parserPath,
        inputPath,
        `Parser exited successfully but did not write ${path.basename(jsonPath)}.`,
      );
    }
    throw err;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new CustomStatementParserFailed(
      parserPath,
      inputPath,
      `Parser wrote invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = abacusJsonSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CustomStatementParserFailed(
      parserPath,
      inputPath,
      `Parser output does not match the Abacus JSON contract: ${parsed.error.message}`,
    );
  }
  return jsonText;
}

async function runCustomStatementParserAndRead(
  parserPath: string,
  inputPath: string,
  quiet = false,
): Promise<string> {
  const jsonPath = abacusJsonPathForInput(inputPath);
  await unlink(jsonPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });
  await runCustomStatementParser(parserPath, inputPath, quiet);
  return readGeneratedAbacusJson(parserPath, inputPath);
}

async function runCustomStatementParsers(
  parserPath: string,
  inputPaths: string[],
): Promise<string[]> {
  const jsonTexts: string[] = [];
  for (const inputPath of inputPaths) {
    jsonTexts.push(
      await runCustomStatementParserAndRead(parserPath, inputPath),
    );
  }
  return jsonTexts;
}

export async function autoDetectCustomStatementParsers(
  parserPaths: string[],
  inputPaths: string[],
): Promise<{ jsonTexts: string[]; parserPaths: string[] }> {
  const jsonTexts: string[] = [];
  const matchedParserPaths: string[] = [];

  for (const inputPath of inputPaths) {
    const matches: Array<{ parserPath: string; jsonText: string }> = [];
    for (const parserPath of parserPaths) {
      const resolvedParserPath = resolveCustomStatementParserPath(parserPath);
      try {
        const jsonText = await runCustomStatementParserAndRead(
          resolvedParserPath,
          inputPath,
          true,
        );
        matches.push({ parserPath, jsonText });
      } catch (err) {
        if (!(err instanceof CustomStatementParserFailed)) throw err;
      }
    }

    if (matches.length !== 1) {
      throw new CustomStatementParserDetectionFailed(
        inputPath,
        matches.map((match) => match.parserPath),
        parserPaths,
      );
    }
    const [match] = matches;
    console.log(
      `[statement-upload] auto-detected parser ${match.parserPath} for ${path.basename(inputPath)}`,
    );
    jsonTexts.push(match.jsonText);
    matchedParserPaths.push(match.parserPath);
  }

  return { jsonTexts, parserPaths: matchedParserPaths };
}

export async function extractXlsStatements(
  xlsPaths: string[],
): Promise<ExtractedStatementSource[]> {
  return Promise.all(
    xlsPaths.map(async (xlsPath) => {
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(await readFile(xlsPath), {
          type: "buffer",
          cellDates: true,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new XlsExtractionFailed(
          `${path.basename(xlsPath)} is not a readable XLS workbook: ${detail}`,
        );
      }

      const transactionTexts = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        return sheet
          ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim()
          : "";
      }).filter((text) => text.length > 0);

      if (transactionTexts.length === 0) {
        throw new XlsExtractionFailed(
          `${path.basename(xlsPath)} does not contain any non-empty worksheets.`,
        );
      }

      return {
        sourceName: path.basename(xlsPath),
        transactionTexts,
        balanceText: transactionTexts.join("\n"),
      } satisfies ExtractedStatementSource;
    }),
  );
}

async function extractPdfs(
  pdfPaths: string[],
  workDir: string,
  tool: ExtractionTool,
): Promise<ExtractedStatementSource[]> {
  console.log(
    `[statement-upload] extracting ${pdfPaths.length} PDF file(s) with ${tool}`,
  );
  const sources: ExtractedStatementSource[] = [];
  for (let index = 0; index < pdfPaths.length; index++) {
    const pdfPath = pdfPaths[index];
    const txtPath = path.join(workDir, `statement-${index + 1}-full.txt`);
    await runPdftotext(pdfPath, txtPath);
    const balanceText = await readFile(txtPath, "utf8");

    let transactionTexts: string[];
    if (tool === "pdftotext") {
      transactionTexts = [balanceText];
    } else {
      const outPrefixName = `statement-${index + 1}-table`;
      const outPrefix = path.join(workDir, outPrefixName);
      await runPdfExtractor([pdfPath], outPrefix);
      const tableNames = (await readdir(workDir))
        .filter(
          (name) =>
            name.startsWith(`${outPrefixName}-`) && name.endsWith(".csv"),
        )
        .sort();
      if (tableNames.length === 0) {
        throw new PdfExtractionFailed(
          `The extractor produced no transaction tables for ${path.basename(pdfPath)}. The statement format may not match any known table layout.`,
        );
      }
      transactionTexts = await Promise.all(
        tableNames.map((name) => readFile(path.join(workDir, name), "utf8")),
      );
      tableNames.forEach((name, tableIndex) =>
        console.log(
          `[statement-upload]   PDF ${index + 1}/${pdfPaths.length}, table ${tableIndex + 1}/${tableNames.length}: ${name}`,
        ),
      );
    }

    sources.push({
      sourceName: path.basename(pdfPath),
      transactionTexts,
      balanceText,
    });
  }
  return sources;
}

function runPdftotext(pdfPath: string, txtPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-layout", pdfPath, txtPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(`[pdftotext] ${d}`);
    });
    child.on("error", (err) =>
      reject(
        new PdfExtractionFailed(`Could not start pdftotext: ${err.message}`),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new PdfExtractionFailed(
            `pdftotext exited with code ${code}. stderr: ${stderr.trim() || "(empty)"}`,
          ),
        );
      }
    });
  });
}

function runPdfExtractor(pdfPaths: string[], outPrefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "uv",
      ["run", pdfExtractScript, "-o", outPrefix, ...pdfPaths],
      {
        cwd: path.dirname(pdfExtractScript),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stdout?.on("data", (d) => process.stdout.write(`[pdf-extract] ${d}`));
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(`[pdf-extract] ${d}`);
    });
    child.on("error", (err) =>
      reject(
        new PdfExtractionFailed(`Could not start pdf-extract: ${err.message}`),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new PdfExtractionFailed(
            `pdf-extract exited with code ${code}. stderr: ${stderr.trim() || "(empty)"}`,
          ),
        );
      }
    });
  });
}

function multipartBodyRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === "object"
    ? (body as Record<string, unknown>)
    : null;
}

function filesFromField(
  files: Record<string, File | File[]>,
  key: string,
): File[] {
  const raw = files[key];
  const candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return candidates.filter((f) => f instanceof File && f.size > 0);
}

function badRequest(error: string, message?: string) {
  return {
    status: 400 as const,
    body: {
      error,
      ...(message ? { message } : {}),
    } satisfies ImportErrorBody,
  };
}

const api = new TsRestApi<SapportaEnv>();

api.register(
  "uploadStatementBatch",
  importDraftsContract.uploadStatementBatch,
  async ({ c, request, files: uploadedFiles }) => {
    const auth = requireWorkflowAuth(c);
    const body = multipartBodyRecord(request.body);
    if (!body) {
      return badRequest(
        "invalid_multipart_body",
        "Expected multipart form fields in the request body.",
      );
    }

    const files = filesFromField(uploadedFiles, "files");
    if (files.length === 0) {
      return badRequest(
        "missing_multipart_field",
        "Missing 'files' field in multipart upload",
      );
    }

    const classification = classifyBatch(files);
    if (!classification.ok) {
      return badRequest("mixed_statement_batch", classification.error);
    }
    const { kind } = classification;
    console.log(
      `[statement-upload] received ${files.length} file(s); classified batch as ${kind}`,
    );
    files.forEach((file, index) =>
      console.log(
        `[statement-upload]   upload ${index + 1}/${files.length}: name=${JSON.stringify(file.name)}, size=${file.size}B, type=${JSON.stringify(file.type || "(unspecified)")}`,
      ),
    );

    if (kind === "json") {
      return respondWithImportErrors(async () => {
        const opts = jsonOptionsFromMultipartBody(body);
        const jsonTexts = await Promise.all(files.map((f) => f.text()));
        return runAbacusJsonImport(jsonTexts, opts, c.get("db"), auth);
      });
    }

    const customParserPath = customParserPathFromBody(body);
    const autoDetectParser = autoDetectStatementParserFromBody(body);
    if (customParserPath !== null && autoDetectParser) {
      return badRequest(
        "custom_statement_parser_conflict",
        "Choose either a preset parser or automatic parser detection, not both.",
      );
    }

    if (autoDetectParser) {
      return respondWithImportErrors(() =>
        withTempUploads(files, "statement-upload", async (_workDir, paths) => {
          const detected = {
            jsonTexts: [] as string[],
            parserPaths: [] as string[],
          };
          for (const inputPath of paths) {
            const candidates = await savedCustomStatementParserPaths(
              path.extname(inputPath),
            );
            const one = await autoDetectCustomStatementParsers(candidates, [
              inputPath,
            ]);
            detected.jsonTexts.push(...one.jsonTexts);
            detected.parserPaths.push(...one.parserPaths);
          }
          const result = await runAbacusJsonImport(
            detected.jsonTexts,
            optionsFromMultipartBody(body),
            c.get("db"),
            auth,
          );
          return {
            ...result,
            custom_statement_parser_paths: detected.parserPaths,
          };
        }),
      );
    }

    if (customParserPath !== null) {
      const allowedParserPaths = await configuredCustomStatementParserPaths();
      const resolvedParserPath = resolveAllowedCustomStatementParserPath(
        customParserPath,
        allowedParserPaths,
      );
      if (resolvedParserPath === null) {
        return badRequest(
          "custom_statement_parser_not_allowed",
          "The requested custom statement parser path is not declared in import presets.",
        );
      }
      return respondWithImportErrors(() =>
        withTempUploads(files, "statement-upload", async (_workDir, paths) => {
          const jsonTexts = await runCustomStatementParsers(
            resolvedParserPath,
            paths,
          );
          const result = await runAbacusJsonImport(
            jsonTexts,
            optionsFromMultipartBody(body),
            c.get("db"),
            auth,
          );
          return {
            ...result,
            custom_statement_parser_paths: paths.map(() => customParserPath),
          };
        }),
      );
    }

    const extractionTool = parseExtractionTool(body.extraction_tool);
    console.log(
      kind === "pdf"
        ? `[statement-upload] parser path: PDF extraction (${extractionTool}) -> freeform importer`
        : kind === "xls"
          ? `[statement-upload] parser path: XLS worksheets converted to CSV -> freeform importer`
          : `[statement-upload] parser path: uploaded text passed directly to freeform importer`,
    );
    return respondWithImportErrors(() =>
      withTempUploads(files, "statement-upload", async (workDir, paths) => {
        if (kind === "pdf") {
          const sources = await extractPdfs(paths, workDir, extractionTool);
          return runFreeformSourceImport(
            sources,
            optionsFromMultipartBody(body),
            c.get("db"),
            auth,
          );
        }
        if (kind === "xls") {
          const sources = await extractXlsStatements(paths);
          return runFreeformSourceImport(
            sources,
            optionsFromMultipartBody(body),
            c.get("db"),
            auth,
          );
        }
        return runFreeformImport(
          argsFromMultipartBody(body, paths),
          c.get("db"),
          auth,
        );
      }),
    );
  },
);

export default api;
