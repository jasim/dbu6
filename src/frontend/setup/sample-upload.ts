import { getApiBase } from "@sapporta/frontend/platform";
import {
  firstStatementRefusalSchema,
  sampleFindingSchema,
  type FirstStatementRefusal,
  type FirstStatementRequest,
  type SampleFinding,
} from "../../shared/index";
import {
  readImportResponse,
  type ImportOutcome,
} from "../views/import-statements/outcome";

/**
 * Stages one statement as a preset account's first statement and reads what
 * the saved parsers made of it. A plain fetch: the typed client sends JSON,
 * and this is multipart. Throws with the server's words when it refuses.
 */
export async function uploadSample(
  accountId: number,
  file: File,
): Promise<SampleFinding> {
  const form = new FormData();
  form.append("account_id", String(accountId));
  form.append("file", file);
  const response = await fetch(`${getApiBase()}/setup/sample-statement`, {
    method: "POST",
    body: form,
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const finding = sampleFindingSchema.safeParse(body);
    if (finding.success) return finding.data;
    throw new Error(
      "The server's answer about the statement couldn't be read.",
    );
  }
  const error =
    body && typeof body === "object" && "error" in body ? body.error : null;
  throw new Error(
    typeof error === "string"
      ? error
      : `The statement couldn't be read (HTTP ${response.status}).`,
  );
}

/** Importing a first statement: refused before it ran, or its import's outcome. */
export type FirstStatementReply =
  { kind: "refused"; refusal: FirstStatementRefusal } | ImportOutcome;

/**
 * Imports an account's staged first statement. A plain fetch, as /import
 * sends its batch: the reply is /import's, read by `readImportResponse`,
 * unless the step refused it first.
 */
export async function sendFirstStatement(
  request: FirstStatementRequest,
): Promise<FirstStatementReply> {
  let response: Response;
  try {
    response = await fetch(`${getApiBase()}/setup/first-statement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    return {
      kind: "failed",
      failure: {
        kind: "network",
        message: err instanceof Error ? err.message : "Import failed",
      },
    };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const refusal = firstStatementRefusalSchema.safeParse(body);
    if (refusal.success) return { kind: "refused", refusal: refusal.data };
  }
  return readImportResponse(response.status, body);
}
