// Typed client for this project's own contracts.
//
// Use `getApiBase` so calls work in development through the Vite proxy and in
// production against the deployed API URL.
//
// Each method returns the 2xx body on success and throws `ApiError` on
// non-2xx. Add a client entry each time you ship a new contract in
// `src/shared`.
//
// Usage:
//   import { journalsApi } from "./api";
//   const { journal } = await journalsApi.renderHledger({ body });

import { createApiClient, type ThrowingClient } from "@sapporta/shared/client";
import type { AppRouter } from "@sapporta/rest-core";
import { getApiBase, fetchApi } from "@sapporta/frontend/platform";
import {
  accountsContract,
  addAccountContract,
  agentHandoffContract,
  categorizationLessonsContract,
  codingAgentContract,
  commentWriterContract,
  draftTransactionsContract,
  homeContract,
  importDraftsContract,
  importPresetsContract,
  journalsContract,
  openingBalancesContract,
  reviewContract,
  setupContract,
} from "../shared/index";

/**
 * A typed client for a report's own contract, against this app's API: each
 * route of the contract is a method that resolves to the 2xx body and throws
 * `ApiError` otherwise. `reportClient(contract).myReport({ query })`.
 */
export function reportClient<TContract extends AppRouter>(
  contract: TContract,
): ThrowingClient<TContract> {
  return createApiClient(contract, { baseUrl: getApiBase });
}

export const importPresetsApi = createApiClient(importPresetsContract, {
  baseUrl: getApiBase,
});

// One account's name, type and parent, written together. Creating one is the
// table API's (`createTableRow`); deleting one is `removeAccount` below.
export const accountsApi = createApiClient(accountsContract, {
  baseUrl: getApiBase,
});

/**
 * Deletes one account: no sub-accounts, entries or drafts, and not a bank or
 * card. The contract's own route, called without the typed client because
 * that client parses every response body as JSON and this route answers 204
 * with nothing — the framework labels the empty body `application/json`, so
 * the parse throws. Sapporta's own frontend calls its 204 route the same way.
 * The contract still declares the route, so the OpenAPI document and the CLI
 * have it.
 */
export async function removeAccount(id: number): Promise<void> {
  await fetchApi(`/accounts/${id}`, { method: "DELETE" });
}

export const draftTransactionsApi = createApiClient(draftTransactionsContract, {
  baseUrl: getApiBase,
});

export const categorizationLessonsApi = createApiClient(
  categorizationLessonsContract,
  { baseUrl: getApiBase },
);

export const journalsApi = createApiClient(journalsContract, {
  baseUrl: getApiBase,
});

export const homeApi = createApiClient(homeContract, {
  baseUrl: getApiBase,
});

export const reviewApi = createApiClient(reviewContract, {
  baseUrl: getApiBase,
});

export const openingBalancesApi = createApiClient(openingBalancesContract, {
  baseUrl: getApiBase,
});

export const agentHandoffApi = createApiClient(agentHandoffContract, {
  baseUrl: getApiBase,
});

export const codingAgentApi = createApiClient(codingAgentContract, {
  baseUrl: getApiBase,
});

export const setupApi = createApiClient(setupContract, {
  baseUrl: getApiBase,
});

export const commentWriterApi = createApiClient(commentWriterContract, {
  baseUrl: getApiBase,
});

// The add itself is multipart, sent by add-account/upload.ts; this is for
// its progress.
export const addAccountApi = createApiClient(addAccountContract, {
  baseUrl: getApiBase,
});

// The upload itself is multipart, sent by import-statements/outcome.ts;
// this is for its progress.
export const importDraftsApi = createApiClient(importDraftsContract, {
  baseUrl: getApiBase,
});

/**
 * What went wrong, in the server's words: the `error` of an API error body,
 * else the thrown error's message.
 */
export function apiErrorMessage(value: unknown): string {
  if (value && typeof value === "object" && "body" in value) {
    const body = value.body;
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  }
  if (value instanceof Error) return value.message;
  return String(value);
}

/**
 * A refusal the server explains in `message`, else what went wrong as
 * `apiErrorMessage` reads it.
 */
export function apiRefusalMessage(value: unknown): string {
  if (value && typeof value === "object" && "body" in value) {
    const body = value.body;
    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
  }
  return apiErrorMessage(value);
}
