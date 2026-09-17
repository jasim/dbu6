import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Nua } from "nuabase";
import { localAgent } from "nuabase/local-agent";
import type { z } from "zod";
import {
  categorizationEngineSchema,
  CATEGORIZATION_ENGINE_LABEL,
  type CategorizationEngine,
  type CodingAgent,
} from "dbu6-shared";

/*
 * Where categorization's LLM runs, chosen once per process by LLM_ENGINE:
 *
 * - `nuabase` (the default): the Nuabase gateway, paid for with
 *   NUABASE_API_KEY, on a provider model.
 * - `claude-code` or `codex`: the coding agent installed and logged in on this
 *   machine, in Nuabase's headless mode, billed to the user's own plan. It
 *   runs the agent's own model (LOCAL_AGENT_MODEL, or its default) and can't
 *   take a provider model.
 *
 * Detection never picks the engine: switching between the Nuabase account and
 * the user's plan must not happen silently.
 */

export type LlmEngineSettings =
  | { engine: "nuabase"; apiKey: string | null }
  | {
      engine: CodingAgent;
      model: string | undefined;
      binaryPath: string | undefined;
    };

export type ParsedLlmEngineSettings =
  { ok: true; settings: LlmEngineSettings } | { ok: false; message: string };

/** Reads LLM_ENGINE and the settings it uses. Blank values count as unset. */
export function parseLlmEngineSettings(
  env: Readonly<Record<string, string | undefined>>,
): ParsedLlmEngineSettings {
  const value = (name: string) => env[name]?.trim() || undefined;
  const engine = categorizationEngineSchema.safeParse(
    value("LLM_ENGINE") ?? "nuabase",
  );
  if (!engine.success) {
    return {
      ok: false,
      message: `LLM_ENGINE must be one of ${categorizationEngineSchema.options.join(", ")}; it is ${JSON.stringify(env.LLM_ENGINE)}.`,
    };
  }
  if (engine.data === "nuabase") {
    return {
      ok: true,
      settings: { engine: "nuabase", apiKey: value("NUABASE_API_KEY") ?? null },
    };
  }
  // The agent runs in a temporary directory, where a relative path means
  // something else.
  const binaryPath = value("LOCAL_AGENT_BINARY");
  if (binaryPath !== undefined && !isAbsolute(binaryPath)) {
    return {
      ok: false,
      message: `LOCAL_AGENT_BINARY must be an absolute path; it is ${JSON.stringify(binaryPath)}.`,
    };
  }
  return {
    ok: true,
    settings: {
      engine: engine.data,
      model: value("LOCAL_AGENT_MODEL"),
      binaryPath,
    },
  };
}

// The part of a nuabase client categorization calls. The package's own
// declarations don't resolve under NodeNext, so they can't be used here.
export type ListRow = { id: string; text: string };
export type ListResult =
  { success: true; data: unknown[] } | { success: false; error: string };
export type ProviderModel = { provider: string; model: string };
export interface NuaListClient {
  list(
    prompt: string,
    options: {
      input: ListRow[];
      primaryKey: "id";
      output: { name: string; schema: z.ZodType<string> };
      model?: ProviderModel;
    },
  ): Promise<ListResult>;
}

export interface CategorizationLlm {
  engine: CategorizationEngine;
  /** The client and the model to name in each call, or why no call can run. */
  caller:
    | { ready: true; nua: NuaListClient; model: ProviderModel | undefined }
    | { ready: false; reason: string };
  /** The most descriptions one call carries; null sends them all at once. */
  maxRowsPerCall: number | null;
}

const GATEWAY_MODEL: ProviderModel = {
  provider: "openrouter",
  model: "z-ai/glm-5.2",
};

// Each local call is one CLI process with a 180 s timeout, two at a time.
const LOCAL_AGENT_ROWS_PER_CALL = 50;

/**
 * Sets up the engine the settings name. Throws, with what to fix, when a local
 * agent can't be found: the server doesn't start on a setting that can never
 * work. A missing NUABASE_API_KEY doesn't throw; imports still run, leaving
 * transactions uncategorized, and say why.
 */
export function buildCategorizationLlm(
  settings: LlmEngineSettings,
): CategorizationLlm {
  if (settings.engine === "nuabase") {
    return {
      engine: "nuabase",
      caller:
        settings.apiKey === null
          ? { ready: false, reason: "NUABASE_API_KEY is not set" }
          : {
              ready: true,
              nua: Nua.gateway({ apiKey: settings.apiKey }),
              model: GATEWAY_MODEL,
            },
      maxRowsPerCall: null,
    };
  }

  const label = CATEGORIZATION_ENGINE_LABEL[settings.engine];
  if (settings.binaryPath !== undefined) {
    assertExecutableFile(settings.binaryPath, label);
  }
  let agent: unknown;
  try {
    agent = localAgent({
      agent: settings.engine,
      model: settings.model,
      binaryPath: settings.binaryPath,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `LLM_ENGINE is ${settings.engine}, but ${label} can't be set up: ${reason} ` +
        "Install it, set LOCAL_AGENT_BINARY to its executable, or unset LLM_ENGINE to use Nuabase.",
      { cause: error },
    );
  }
  return {
    engine: settings.engine,
    // No per-call model: a local agent takes its own model names only.
    caller: {
      ready: true,
      nua: Nua.direct({ localAgent: agent }),
      model: undefined,
    },
    maxRowsPerCall: LOCAL_AGENT_ROWS_PER_CALL,
  };
}

function assertExecutableFile(path: string, label: string): void {
  let problem: string | null = null;
  try {
    if (!statSync(path).isFile()) problem = "is not a file";
    else accessSync(path, constants.X_OK);
  } catch (error) {
    problem =
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "does not exist"
        : "is not executable";
  }
  if (problem !== null) {
    throw new Error(
      `LOCAL_AGENT_BINARY (${path}) ${problem}. Set it to ${label}'s executable, or unset it to find ${label} on PATH.`,
    );
  }
}

let engine: CategorizationLlm | null = null;

/**
 * The engine this process categorizes with, set up from the environment on
 * first use and kept. boot.ts calls it at startup so a bad setting stops the
 * server there.
 */
export function categorizationLlm(): CategorizationLlm {
  if (engine === null) {
    const parsed = parseLlmEngineSettings(process.env);
    if (!parsed.ok) throw new Error(parsed.message);
    engine = buildCategorizationLlm(parsed.settings);
    console.log(
      `[llm-engine] categorization runs on ${CATEGORIZATION_ENGINE_LABEL[engine.engine]}` +
        (engine.caller.ready ? "" : ` (unavailable: ${engine.caller.reason})`),
    );
  }
  return engine;
}
