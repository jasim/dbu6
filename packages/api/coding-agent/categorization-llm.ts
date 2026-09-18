import { CODING_AGENTS, NO_CODING_AGENT_MESSAGE } from "dbu6-shared";
import type { CategorizationLlm } from "../modules/categorization/index.js";
import { currentCodingAgent } from "./agents.js";
import { noAgentModelReason } from "./errors.js";
import { agentModels } from "./models.js";
import {
  agentListClient,
  gatewayListClient,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Where categorization's LLM runs:
 *
 * - The coding agent dbu6 uses (agents.ts), headless, billed to the user's own
 *   Claude or ChatGPT plan, on the least capable of its models that answered
 *   (models.ts). This is the default, and the only choice the app offers.
 * - The Nuabase gateway, paid for with NUABASE_API_KEY, when
 *   LLM_ENGINE=nuabase. Deprecated: kept for instances with no coding agent,
 *   such as the Docker image. The app never offers it, and the gateway is the
 *   only engine that isn't a coding agent, so a report of a run on it names no
 *   agent.
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

const GATEWAY_NAME = "the Nuabase gateway";
const GATEWAY_MODEL = { provider: "openrouter", model: "z-ai/glm-5.2" };

// A coding agent answers one call at a time per description batch, so calls
// stay small; the gateway takes every description at once.
const LOCAL_AGENT_ROWS_PER_CALL = 50;

export function gatewayLlm(apiKey: string | null): CategorizationLlm {
  return {
    agent: null,
    name: GATEWAY_NAME,
    caller:
      apiKey === null
        ? {
            ready: false,
            reason: "NUABASE_API_KEY is not set for the Nuabase gateway.",
          }
        : {
            ready: true,
            client: gatewayListClient(apiKey, GATEWAY_MODEL),
            maxRowsPerCall: null,
          },
  };
}

/** Categorization on a coding agent, on one of its models. */
export function localAgentLlm(
  agent: InstalledAgent,
  model: string,
): CategorizationLlm {
  return {
    agent: agent.agent,
    name: CODING_AGENTS[agent.agent].label,
    caller: {
      ready: true,
      client: agentListClient(agent, model),
      maxRowsPerCall: LOCAL_AGENT_ROWS_PER_CALL,
    },
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
        `[llm-engine] categorization runs on ${GATEWAY_NAME} (LLM_ENGINE=nuabase, deprecated)`,
      );
    }
  }
  return setting;
}

let gateway: CategorizationLlm | null = null;
// One client per agent executable and model, so the limit on processes running
// at once (nuabase.ts) holds across requests.
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
    return {
      agent: null,
      name: "no coding agent",
      caller: { ready: false, reason: NO_CODING_AGENT_MESSAGE },
    };
  }
  // At startup the check may still be running; it takes a few seconds.
  const models = await agentModels(agent);
  if (models.state === "no_model") {
    return {
      agent: agent.agent,
      name: CODING_AGENTS[agent.agent].label,
      caller: {
        ready: false,
        reason: noAgentModelReason(agent.agent, models.unavailable),
      },
    };
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
