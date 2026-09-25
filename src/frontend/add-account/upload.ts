import { getApiBase } from "@sapporta/frontend/platform";
import {
  addAccountAddedSchema,
  addAccountReadingSchema,
  addAccountRefusalSchema,
  type AddAccountAdded,
  type AddAccountFields,
  type AddAccountReading,
  type AddAccountRefusal,
} from "../../shared/index";

/*
 * /add's two requests (addAccountContract). Both are multipart, so they are
 * plain fetches, as /import sends its batch: the typed client sends JSON.
 * Each reply is parsed here once, against the contract's schemas.
 */

function form(files: readonly File[]): FormData {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return body;
}

async function post(path: string, body: FormData): Promise<Response> {
  try {
    return await fetch(`${getApiBase()}${path}`, { method: "POST", body });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "The request failed.",
    );
  }
}

function serverWords(body: unknown, status: number, what: string): string {
  const error =
    body && typeof body === "object" && "error" in body ? body.error : null;
  return typeof error === "string" ? error : `${what} (HTTP ${status}).`;
}

/**
 * What dbu6 makes of the dropped files, writing nothing. Throws with the
 * server's words when it refuses.
 */
export async function readStatements(
  files: readonly File[],
): Promise<AddAccountReading> {
  const response = await post("/add-account/read", form(files));
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const reading = addAccountReadingSchema.safeParse(body);
    if (reading.success) return reading.data;
    throw new Error(
      "The server's answer about the statements couldn't be read.",
    );
  }
  throw new Error(
    serverWords(body, response.status, "The statements couldn't be read"),
  );
}

export type AddReply =
  | { kind: "added"; added: AddAccountAdded }
  | { kind: "refused"; refusal: AddAccountRefusal };

/**
 * Adds the account and imports its files. A refusal the contract names is
 * returned; anything else throws with the server's words.
 */
export async function sendAdd(
  files: readonly File[],
  fields: AddAccountFields,
): Promise<AddReply> {
  const body = form(files);
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) body.append(name, String(value));
  }
  const response = await post("/add-account/add", body);
  const reply: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const added = addAccountAddedSchema.safeParse(reply);
    if (added.success) return { kind: "added", added: added.data };
    throw new Error(
      "The account may have been added, but the server's answer couldn't be read.",
    );
  }
  const refusal = addAccountRefusalSchema.safeParse(reply);
  if (refusal.success) return { kind: "refused", refusal: refusal.data };
  throw new Error(
    serverWords(reply, response.status, "The account couldn't be added"),
  );
}
