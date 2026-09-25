import { getApiBase } from "@sapporta/frontend/platform";
import { sampleFindingSchema, type SampleFinding } from "../../shared/index";

/**
 * Sends one sample statement for a preset account and reads what the saved
 * parsers made of it. A plain fetch: the typed client sends JSON, and this is
 * multipart. Throws with the server's words when it refuses.
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
    throw new Error("The server's answer about the sample couldn't be read.");
  }
  const error =
    body && typeof body === "object" && "error" in body ? body.error : null;
  throw new Error(
    typeof error === "string"
      ? error
      : `The sample couldn't be checked (HTTP ${response.status}).`,
  );
}
