import {
  CODING_AGENTS,
  NO_CODING_AGENT_MESSAGE,
  type CodingAgent,
} from "../../../shared/index.js";
import type { CategorizationLlm } from "../categorization/index.js";
import { currentCodingAgent } from "./agents.js";
import { noAgentModelReason } from "./errors.js";
import {
  agentModels,
  checkAgentModelsAgain,
  type CheckedAgentModels,
} from "./models.js";
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

export const GATEWAY_NAME = "the Nuabase gateway";
export const GATEWAY_MODEL = { provider: "openrouter", model: "z-ai/glm-5.2" };

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
            // The gateway has no check: a failed call is taken as passing.
            confirmUnavailable: () => Promise.resolve(null),
          },
  };
}

/**
 * After a failed call: asks the agent's models again, which keeps the result,
 * and says why the agent can't be used when none answered. The kept no_model
 * check makes later runs skip the agent (`categorizationLlm`) until Settings
 * checks again.
 */
export async function confirmAgentUnavailable(
  agent: InstalledAgent,
): Promise<string | null> {
  const models = await checkAgentModelsAgain(agent);
  return models.state === "no_model"
    ? noAgentModelReason(agent.agent, models.unavailable)
    : null;
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
      confirmUnavailable: () => confirmAgentUnavailable(agent),
    },
  };
}

let setting: LlmEngineSetting | null = null;

/**
 * LLM_ENGINE, read once. Throws on a value that can never work; `serveDbu6` calls
 * it at startup so the server stops there.
 */
export function llmEngineSetting(): LlmEngineSetting {
  if (setting === null) {
    const parsed = parseLlmEngineSetting(process.env);
    if (!parsed.ok) throw new Error(parsed.message);
    setting = parsed.setting;
    if (setting.engine === "nuabase") {
      console.log(
        `[llm-engine] categorization and chart suggestions run on ${GATEWAY_NAME} (LLM_ENGINE=nuabase, deprecated)`,
      );
    }
  }
  return setting;
}

let gateway: CategorizationLlm | null = null;
// One client per agent executable and model, so the limit on processes running
// at once (nuabase.ts) holds across requests.
const localAgents = new Map<string, CategorizationLlm>();

/**
 * What an LLM call can run on right now, for categorization and for the
 * setup's chart of accounts (chart-llm.ts): the gateway when
 * LLM_ENGINE says so, else the coding agent dbu6 uses with its checked
 * models, or why neither can answer.
 */
export type LlmEngine =
  | { kind: "gateway"; apiKey: string | null }
  | {
      kind: "agent";
      agent: InstalledAgent;
      models: Extract<CheckedAgentModels, { state: "ready" }>;
    }
  | { kind: "unavailable"; agent: CodingAgent | null; reason: string };

export async function currentLlmEngine(): Promise<LlmEngine> {
  const current = llmEngineSetting();
  if (current.engine === "nuabase") {
    return { kind: "gateway", apiKey: current.apiKey };
  }
  const agent = await currentCodingAgent();
  if (agent === null) {
    return {
      kind: "unavailable",
      agent: null,
      reason: NO_CODING_AGENT_MESSAGE,
    };
  }
  // At startup the check may still be running; it takes a few seconds.
  const models = await agentModels(agent);
  if (models.state === "no_model") {
    return {
      kind: "unavailable",
      agent: agent.agent,
      reason: noAgentModelReason(agent.agent, models.unavailable),
    };
  }
  return { kind: "agent", agent, models };
}

/** What to call an engine that can't answer, in the log and on screen. */
export function unavailableEngineName(agent: CodingAgent | null): string {
  return agent === null ? "no coding agent" : CODING_AGENTS[agent].label;
}

/** The engine categorization runs on right now. */
export async function categorizationLlm(): Promise<CategorizationLlm> {
  const engine = await currentLlmEngine();
  switch (engine.kind) {
    case "gateway":
      gateway ??= gatewayLlm(engine.apiKey);
      return gateway;
    case "unavailable":
      return {
        agent: engine.agent,
        name: unavailableEngineName(engine.agent),
        caller: { ready: false, reason: engine.reason },
      };
    case "agent": {
      const { agent } = engine;
      const { model } = engine.models.categorization;
      const key = `${agent.agent}:${agent.binaryPath}:${model}`;
      let llm = localAgents.get(key);
      if (llm === undefined) {
        llm = localAgentLlm(agent, model);
        localAgents.set(key, llm);
      }
      return llm;
    }
  }
}
