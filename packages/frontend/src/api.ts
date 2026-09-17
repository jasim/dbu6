// Typed client for this project's own contracts.
//
// Use `getApiBase` so calls work in development through the Vite proxy and in
// production against the deployed API URL.
//
// Each method returns the 2xx body on success and throws `ApiError` on
// non-2xx. Add a client entry each time you ship a new contract in
// `dbu6-shared`.
//
// Usage:
//   import { journalsApi } from "./api";
//   const { journal } = await journalsApi.renderHledger({ body });

import { createApiClient } from "@sapporta/shared/client";
import { getApiBase } from "@sapporta/frontend/platform";
import {
  agentHandoffContract,
  draftTransactionsContract,
  homeContract,
  importPresetsContract,
  journalsContract,
  reportsContract,
  reviewContract,
} from "dbu6-shared";

export const reportsApi = createApiClient(reportsContract, {
  baseUrl: getApiBase,
});

export const importPresetsApi = createApiClient(importPresetsContract, {
  baseUrl: getApiBase,
});

export const draftTransactionsApi = createApiClient(draftTransactionsContract, {
  baseUrl: getApiBase,
});

export const journalsApi = createApiClient(journalsContract, {
  baseUrl: getApiBase,
});

export const homeApi = createApiClient(homeContract, {
  baseUrl: getApiBase,
});

export const reviewApi = createApiClient(reviewContract, {
  baseUrl: getApiBase,
});

export const agentHandoffApi = createApiClient(agentHandoffContract, {
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
