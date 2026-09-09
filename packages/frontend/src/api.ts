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
  draftTransactionsContract,
  importPresetsContract,
  journalsContract,
  reportsContract,
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
