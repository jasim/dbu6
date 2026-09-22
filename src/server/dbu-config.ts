import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { z } from "zod";
import { Temporal } from "@sapporta/shared/temporal";
import { dbuConfigTable } from "./schema/dbu-config.js";

/*
 * What dbu6 found out about this machine and keeps across restarts, in the
 * dbu_config table: one JSON value per key. It is not in a request's scope,
 * so the runtime binds the store once when it opens the database
 * (`useDbuConfig` in runtime.ts), as it sets the project root; a test binds
 * `memoryDbuConfig()`.
 */

/** Every key dbu6 keeps, and whose it is. */
export type DbuConfigKey =
  /** The coding agents detected on this machine (coding-agent/agents.ts). */
  | "coding_agent.agents"
  /** Which of each agent's models answered (coding-agent/models.ts). */
  | "coding_agent.models";

export interface DbuConfigStore {
  /** The stored JSON value, or undefined when the key has none. */
  read(key: DbuConfigKey): unknown;
  write(key: DbuConfigKey, value: unknown): void;
}

export function sqliteDbuConfig(db: BetterSQLite3Database): DbuConfigStore {
  return {
    read(key) {
      const row = db
        .select({ value: dbuConfigTable.value })
        .from(dbuConfigTable)
        .where(eq(dbuConfigTable.key, key))
        .get();
      return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
    },
    write(key, value) {
      const json = JSON.stringify(value);
      db.insert(dbuConfigTable)
        .values({ key, value: json })
        .onConflictDoUpdate({
          target: dbuConfigTable.key,
          set: { value: json, updated_at: Temporal.Now.instant() },
        })
        .run();
    },
  };
}

/** A store that lives as long as the process, for tests. */
export function memoryDbuConfig(): DbuConfigStore {
  const values = new Map<DbuConfigKey, string>();
  return {
    read: (key) => {
      const json = values.get(key);
      return json === undefined ? undefined : (JSON.parse(json) as unknown);
    },
    write: (key, value) => void values.set(key, JSON.stringify(value)),
  };
}

let bound: DbuConfigStore | null = null;

export function useDbuConfig(store: DbuConfigStore): void {
  bound = store;
}

function dbuConfig(): DbuConfigStore {
  if (bound === null) {
    throw new Error(
      "dbu_config was read before the runtime opened the database",
    );
  }
  return bound;
}

/**
 * The value under `key`, or null when there is none. A value that doesn't
 * parse, left by an older dbu6, reads as none, so it is found out again.
 */
export function readDbuConfig<T>(
  key: DbuConfigKey,
  schema: z.ZodType<T>,
): T | null {
  const stored = dbuConfig().read(key);
  if (stored === undefined) return null;
  const parsed = schema.safeParse(stored);
  if (parsed.success) return parsed.data;
  console.warn(`[dbu_config] ignoring ${key}, which dbu6 can't read`);
  return null;
}

export function writeDbuConfig(key: DbuConfigKey, value: unknown): void {
  dbuConfig().write(key, value);
}
