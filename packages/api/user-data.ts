import { dataPath } from "@sapporta/server";

/**
 * Everything private to this installation lives in the Sapporta data
 * directory, named by SAPPORTA_DATA_DIR: the SQLite database and the user's
 * own config. Kept as one directory so it can be gitignored, backed up, and
 * mounted into the container as a single unit.
 *
 * Resolved per call rather than at module load so SAPPORTA_DATA_DIR stays
 * effective regardless of import order.
 */

/** Where transaction_mappings.mjs, the prompts, and import-presets.json live. */
export function userConfigDir(): string {
  return dataPath("user-config");
}

export function userConfigPath(...segments: string[]): string {
  return dataPath("user-config", ...segments);
}
