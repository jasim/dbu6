import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { userConfigDir } from "../../paths.js";
import type { Abacus } from "../statement/index.js";
import { type Account, parseAccount } from "../values/index.js";
import type { Categorizer, ConfigPart } from "./categorize.js";
import type { CategorizationLlm } from "./llm-categorization.js";
import {
  classifyWith,
  compileMappings,
  mappingRulesSchema,
  type MappingRules,
} from "./mapping-rules.js";

/*
 * Categorization's top: the one place that reads the user's categorization
 * config and knows its files' names. A workflow loads it once and hands the
 * result to `categorize`.
 */

export interface CategorizerSettings {
  // The preset's instructions for the LLM, in the user-config directory.
  customMappingsFilenames: readonly string[];
  llm: CategorizationLlm;
}

// A user's categorization config file is missing or can't be used.
export class CategorizationConfigError extends Error {
  override readonly name = "CategorizationConfigError";
}

export const TRANSACTION_MAPPINGS_FILENAME = "transaction_mappings.mjs";

type TransactionClassifier = (transaction: Abacus) => Account | null;

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function readRequiredConfigFile(configDir: string, filename: string): string {
  const filePath = join(configDir, filename);
  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new CategorizationConfigError(
        `Missing required categorization config file: ${filePath}.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The user's `transaction_mappings.mjs`, read and validated: the file exists,
 * is a JavaScript module, exports `mappings` in the schema's shape, and its
 * rules compile. Every failure is a `CategorizationConfigError` naming the
 * file. `dbu6 check` calls this to say whether the file still parses.
 */
export async function readTransactionMappings(
  configDir: string,
): Promise<MappingRules> {
  const filePath = join(configDir, TRANSACTION_MAPPINGS_FILENAME);
  readRequiredConfigFile(configDir, TRANSACTION_MAPPINGS_FILENAME);

  let loaded: Record<string, unknown>;
  try {
    loaded = await import(pathToFileURL(filePath).href);
  } catch (error) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${TRANSACTION_MAPPINGS_FILENAME} must be a valid JavaScript module.`,
      { cause: error },
    );
  }

  const rules = mappingRulesSchema.safeParse(loaded.mappings);
  if (!rules.success) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${TRANSACTION_MAPPINGS_FILENAME} must export a "mappings" object of ` +
        `{ exact, includes }: ${rules.error.message}`,
    );
  }

  try {
    compileMappings(rules.data);
  } catch (error) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return rules.data;
}

async function loadTransactionClassifier(
  configDir: string,
): Promise<TransactionClassifier> {
  const compiled = compileMappings(await readTransactionMappings(configDir));
  return (transaction) => {
    const account = classifyWith(compiled, transaction);
    return account === null ? null : parseAccount(account);
  };
}

/**
 * One of the user's instruction files (custom_mappings_*.prompt), as the LLM
 * would get it, or null when it is missing: a run skips a missing file, so
 * Classify drafts shows it as missing rather than failing.
 */
export function readCustomMappingsFile(
  filename: string,
  configDir: string = userConfigDir(),
): string | null {
  try {
    return readFileSync(join(configDir, filename), "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function loadCustomMappings(
  filenames: readonly string[],
  configDir: string,
): string {
  return filenames
    .flatMap((filename) => readCustomMappingsFile(filename, configDir) ?? [])
    .join("\n\n");
}

/**
 * The user's categorization config, read now. A file that is missing or can't
 * be used is kept as the reason, and refuses only once a row needs it
 * (`categorize`), so an import with nothing new needs no config.
 */
export async function loadCategorizer(
  settings: CategorizerSettings,
  configDir: string = userConfigDir(),
): Promise<Categorizer> {
  return {
    classify: await settle(() => loadTransactionClassifier(configDir)),
    customMappings: await settle(() =>
      loadCustomMappings(settings.customMappingsFilenames, configDir),
    ),
    llm: settings.llm,
  };
}

/**
 * How a workflow gets its categorizer. Reclassification, the statement import
 * and the freeform import each take one as an input rather than importing
 * ours, so the runtime can hand all three a replacement.
 */
export type LoadCategorizer = (
  settings: CategorizerSettings,
) => Promise<Categorizer>;

async function settle<T>(load: () => T | Promise<T>): Promise<ConfigPart<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return { ok: false, error };
  }
}
