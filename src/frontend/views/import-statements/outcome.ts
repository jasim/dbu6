import { getApiBase } from "@sapporta/frontend/platform";
import {
  autoImportErrorSchema,
  autoImportResultSchema,
  type AutoImportErrorBody,
  type AutoImportGroupResult,
  type AutoImportPlanFile,
  type AutoImportResult,
} from "../../../shared/index";

/*
 * What a batch of statements came to: the import, or why it stopped. The
 * server's reply is parsed here once, against the contract's schemas, so the
 * cards and the file list read typed fields and never probe the body.
 */

/** One account's import raised a statement import error. */
export type AccountRefusal = Extract<
  AutoImportErrorBody,
  { failed_group: unknown }
>;

/** An account's refusal with one error code, its fields as the contract names them. */
export type RefusalOf<Code extends AccountRefusal["error"]> = Extract<
  AccountRefusal,
  { error: Code }
>;

export type ImportFailure =
  /** The request never got an answer. */
  | { kind: "network"; message: string }
  /** The session isn't allowed to import. */
  | { kind: "forbidden" }
  /** Nothing was imported: some file couldn't be tied to an account in the import presets. */
  | {
      kind: "files-unresolved";
      message: string;
      hint: string;
      files: AutoImportPlanFile[];
    }
  /**
   * One account's import refused. The accounts before it were imported, and
   * their drafts are saved.
   */
  | { kind: "account-refused"; refusal: AccountRefusal }
  /** A reply the contract doesn't describe, kept for the technical details. */
  | { kind: "unexpected"; status: number; body: unknown };

export type ImportOutcome =
  | { kind: "imported"; result: AutoImportResult }
  | { kind: "failed"; failure: ImportFailure };

/** Sends the batch in one request and reads what came back. */
export async function sendStatements(
  files: readonly File[],
  gpay: File | null,
): Promise<ImportOutcome> {
  // A plain fetch: the typed client sends JSON headers, and this is multipart.
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (gpay) form.append("gpay", gpay);

  let response: Response;
  try {
    response = await fetch(`${getApiBase()}/import-draft/statements/auto`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    return {
      kind: "failed",
      failure: {
        kind: "network",
        message: err instanceof Error ? err.message : "Upload failed",
      },
    };
  }
  const body: unknown = await response.json().catch(() => null);
  return readImportResponse(response.status, body);
}

/** The outcome a reply describes. */
export function readImportResponse(
  status: number,
  body: unknown,
): ImportOutcome {
  if (status >= 200 && status < 300) {
    const result = autoImportResultSchema.safeParse(body);
    return result.success
      ? { kind: "imported", result: result.data }
      : { kind: "failed", failure: { kind: "unexpected", status, body } };
  }
  return { kind: "failed", failure: readFailure(status, body) };
}

function readFailure(status: number, body: unknown): ImportFailure {
  if (status === 403) return { kind: "forbidden" };
  const parsed = autoImportErrorSchema.safeParse(body);
  if (!parsed.success) return { kind: "unexpected", status, body };
  const refusal = parsed.data;
  if ("failed_group" in refusal) return { kind: "account-refused", refusal };
  switch (refusal.error) {
    case "auto_import_files_unresolved":
      return {
        kind: "files-unresolved",
        message: refusal.message,
        hint: refusal.hint,
        files: refusal.files,
      };
    case "missing_multipart_field":
      // The screen never sends a batch without files.
      return { kind: "unexpected", status, body };
  }
}

/** Every file the server decided on, whether or not anything was imported. */
export function plannedFiles(outcome: ImportOutcome): AutoImportPlanFile[] {
  if (outcome.kind === "imported") return outcome.result.files;
  switch (outcome.failure.kind) {
    case "files-unresolved":
      return outcome.failure.files;
    case "account-refused":
      return outcome.failure.refusal.files;
    default:
      return [];
  }
}

/** The accounts whose drafts were saved. */
export function importedGroups(
  outcome: ImportOutcome,
): AutoImportGroupResult[] {
  if (outcome.kind === "imported") return outcome.result.groups;
  return outcome.failure.kind === "account-refused"
    ? (outcome.failure.refusal.imported_groups ?? [])
    : [];
}
