import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { userConfigDir } from "../../user-data.js";
import type { Abacus } from "../statement/index.js";
import { type Account, parseAccount } from "../values/index.js";
import type { Categorizer, ConfigPart } from "./categorize.js";
import type { CategorizationLlm } from "./llm-categorization.js";
import {
  classifyWith,
  compileMappings,
  mappingRulesSchema,
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

const TRANSACTION_MAPPINGS_FILENAME = "transaction_mappings.mjs";

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

async function loadTransactionClassifier(
  configDir: string,
): Promise<TransactionClassifier> {
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

  let compiled;
  try {
    compiled = compileMappings(rules.data);
  } catch (error) {
    throw new CategorizationConfigError(
      `Invalid categorization config file: ${filePath}. ` +
        `${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return (transaction) => {
    const account = classifyWith(compiled, transaction);
    return account === null ? null : parseAccount(account);
  };
}

function loadCustomMappings(
  filenames: readonly string[],
  configDir: string,
): string {
  return filenames
    .flatMap((filename) => {
      try {
        return [readFileSync(join(configDir, filename), "utf-8")];
      } catch (error) {
        if (isMissingFileError(error)) return [];
        throw error;
      }
    })
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

async function settle<T>(load: () => T | Promise<T>): Promise<ConfigPart<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return { ok: false, error };
  }
}
