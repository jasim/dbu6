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
import { getApiBase } from "@sapporta/frontend/platform";
import {
  agentHandoffContract,
  codingAgentContract,
  draftTransactionsContract,
  homeContract,
  importPresetsContract,
  journalsContract,
  openingBalancesContract,
  reviewContract,
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

export const openingBalancesApi = createApiClient(openingBalancesContract, {
  baseUrl: getApiBase,
});

export const agentHandoffApi = createApiClient(agentHandoffContract, {
  baseUrl: getApiBase,
});

export const codingAgentApi = createApiClient(codingAgentContract, {
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
