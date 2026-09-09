import { join } from "node:path";
import { projectPath } from "@sapporta/server";

/**
 * Root of everything private to this installation: the SQLite database and the
 * user's own config. Kept as one directory so it can be gitignored, backed up,
 * and mounted into the container (Dockerfile declares it as the volume) as a
 * single unit.
 *
 * Resolved per call rather than at module load so DBU6_DATA_DIR stays
 * effective regardless of import order.
 */
export function userDataDir(): string {
  return process.env.DBU6_DATA_DIR ?? projectPath("data");
}

/** Where transaction_mappings.mjs, the prompts, and import-presets.json live. */
export function userConfigDir(): string {
  return join(userDataDir(), "user-config");
}

export function userConfigPath(...segments: string[]): string {
  return join(userConfigDir(), ...segments);
}
