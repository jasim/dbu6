import { Nua } from "nuabase";
import { localAgent } from "nuabase/local-agent";
import type { z } from "zod";
import {
  CATEGORIZATION_ENGINE_LABEL,
  type CategorizationEngine,
  type CodingAgent,
} from "dbu6-shared";
import { agentModels, noModelMessage } from "./coding-agent-models.js";
import {
  currentCodingAgent,
  NO_CODING_AGENT_MESSAGE,
  type InstalledAgent,
} from "./coding-agent.js";

/*
 * Where categorization's LLM runs:
 *
 * - The coding agent dbu6 uses (coding-agent.ts), in Nuabase's headless mode,
 *   billed to the user's own Claude or ChatGPT plan, on the least capable of
 *   its models that answered (coding-agent-models.ts): Claude Sonnet or GPT-5.6
 *   Terra, or a more capable one when that didn't answer. This is the default,
 *   and the only choice the app offers.
 * - The Nuabase gateway, paid for with NUABASE_API_KEY, when
 *   LLM_ENGINE=nuabase. Deprecated: kept for instances with no coding agent,
 *   such as the Docker image.
 */

export type LlmEngineSetting =
  { engine: "coding-agent" } | { engine: "nuabase"; apiKey: string | null };

export type ParsedLlmEngineSetting =
  { ok: true; setting: LlmEngineSetting } | { ok: false; message: string };

/** Reads LLM_ENGINE and the key it uses. Blank values count as unset. */
export function parseLlmEngineSetting(
  env: Readonly<Record<string, string | undefined>>,
): ParsedLlmEngineSetting {
  const value = (name: string) => env[name]?.trim() || undefined;
  const engine = value("LLM_ENGINE");
  if (engine === undefined) {
    return { ok: true, setting: { engine: "coding-agent" } };
  }
  if (engine === "nuabase") {
    return {
      ok: true,
      setting: { engine: "nuabase", apiKey: value("NUABASE_API_KEY") ?? null },
    };
  }
  return {
    ok: false,
    message: `LLM_ENGINE can only be "nuabase" (the deprecated Nuabase gateway); it is ${JSON.stringify(env.LLM_ENGINE)}. Unset it to use the coding agent chosen in Settings.`,
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
  /** Null when no coding agent is installed. */
  engine: CategorizationEngine | null;
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

export function gatewayLlm(apiKey: string | null): CategorizationLlm {
  return {
    engine: "nuabase",
    caller:
      apiKey === null
        ? { ready: false, reason: "NUABASE_API_KEY is not set" }
        : {
            ready: true,
            nua: Nua.gateway({ apiKey }),
            model: GATEWAY_MODEL,
          },
    maxRowsPerCall: null,
  };
}

/** Categorization on a coding agent, on one of its models. */
export function localAgentLlm(
  agent: InstalledAgent,
  model: string,
): CategorizationLlm {
  return {
    engine: agent.agent,
    // No per-call model: a local agent takes its own model names only.
    caller: {
      ready: true,
      nua: Nua.direct({
        localAgent: localAgent({
          agent: agent.agent,
          model,
          binaryPath: agent.binaryPath,
        }),
      }),
      model: undefined,
    },
    maxRowsPerCall: LOCAL_AGENT_ROWS_PER_CALL,
  };
}

/** Categorization that can't run: no agent (null), or none of its models. */
export function unavailableLocalAgentLlm(
  engine: CodingAgent | null,
  reason: string,
): CategorizationLlm {
  return {
    engine,
    caller: { ready: false, reason },
    maxRowsPerCall: LOCAL_AGENT_ROWS_PER_CALL,
  };
}

let setting: LlmEngineSetting | null = null;

/**
 * LLM_ENGINE, read once. Throws on a value that can never work; boot.ts calls
 * it at startup so the server stops there.
 */
export function llmEngineSetting(): LlmEngineSetting {
  if (setting === null) {
    const parsed = parseLlmEngineSetting(process.env);
    if (!parsed.ok) throw new Error(parsed.message);
    setting = parsed.setting;
    if (setting.engine === "nuabase") {
      console.log(
        `[llm-engine] categorization runs on ${CATEGORIZATION_ENGINE_LABEL.nuabase} (LLM_ENGINE=nuabase, deprecated)`,
      );
    }
  }
  return setting;
}

let gateway: CategorizationLlm | null = null;
// One per agent executable and model, so its limit on processes running at
// once holds across requests.
const localAgents = new Map<string, CategorizationLlm>();

/** The engine categorization runs on right now. */
export async function categorizationLlm(): Promise<CategorizationLlm> {
  const current = llmEngineSetting();
  if (current.engine === "nuabase") {
    gateway ??= gatewayLlm(current.apiKey);
    return gateway;
  }
  const agent = await currentCodingAgent();
  if (agent === null) {
    return unavailableLocalAgentLlm(null, NO_CODING_AGENT_MESSAGE);
  }
  // At startup the check may still be running; it takes a few seconds.
  const models = await agentModels(agent);
  if (models.state === "no_model") {
    return unavailableLocalAgentLlm(
      agent.agent,
      noModelMessage(agent.agent, models.unavailable),
    );
  }
  const { model } = models.categorization;
  const key = `${agent.agent}:${agent.binaryPath}:${model}`;
  let llm = localAgents.get(key);
  if (llm === undefined) {
    llm = localAgentLlm(agent, model);
    localAgents.set(key, llm);
  }
  return llm;
}
