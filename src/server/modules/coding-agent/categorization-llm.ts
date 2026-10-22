import {
  CODING_AGENTS,
  noCodingAgentMessage,
  type CodingAgent,
} from "../../../shared/index.js";
import type { CategorizationLlm } from "../categorization/index.js";
import { noAgentModelReason } from "./errors.js";
import {
  agentModels,
  checkAgentModelsAgain,
  currentCodingAgent,
  type CheckedAgentModels,
} from "./models.js";
import { CODING_AGENT_RUN } from "./agents.js";
import { agentListClient, type InstalledAgent } from "./nuabase.js";

/*
 * Categorization's LLM is the coding agent dbu6 uses (agents.ts), headless,
 * billed to the user's own Claude or ChatGPT plan, on the least capable of its
 * models that answered (models.ts). It is the only engine: what categorization
 * sends reaches the agent's own LLM provider and nothing else.
 */

// Each call is one CLI process, so calls stay small.
const LOCAL_AGENT_ROWS_PER_CALL = 50;

// A run's calls start this far apart, at random, so their processes don't
// all start at once.
const MIN_PAUSE_BETWEEN_CALLS_MS = 3_000;
const MAX_PAUSE_BETWEEN_CALLS_MS = 8_000;

function pauseBetweenCalls(): Promise<void> {
  const ms =
    MIN_PAUSE_BETWEEN_CALLS_MS +
    Math.random() * (MAX_PAUSE_BETWEEN_CALLS_MS - MIN_PAUSE_BETWEEN_CALLS_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Categorization on a coding agent, on one of its models, at the effort dbu6
 * runs it at (agents.ts).
 */
export function localAgentLlm(
  agent: InstalledAgent,
  model: string | undefined,
): CategorizationLlm {
  return {
    agent: agent.agent,
    name: CODING_AGENTS[agent.agent].label,
    caller: {
      ready: true,
      client: agentListClient(agent, {
        model,
        effort: CODING_AGENT_RUN[agent.agent].categorizationEffort,
      }),
      maxRowsPerCall: LOCAL_AGENT_ROWS_PER_CALL,
      confirmUnavailable: () => confirmAgentUnavailable(agent),
      pauseBetweenCalls,
    },
  };
}

/**
 * What an LLM call can run on right now, for categorization and for the
 * setup's chart of accounts (chart-llm.ts): the coding agent dbu6 uses with
 * its checked models, or why it can't answer.
 */
export type LlmEngine =
  | {
      kind: "agent";
      agent: InstalledAgent;
      models: Extract<CheckedAgentModels, { state: "ready" }>;
    }
  | { kind: "unavailable"; agent: CodingAgent | null; reason: string };

export async function currentLlmEngine(): Promise<LlmEngine> {
  const inUse = await currentCodingAgent();
  if (inUse.agent === null) {
    return {
      kind: "unavailable",
      agent: inUse.why.kind === "chosen_missing" ? inUse.why.chosen : null,
      reason: noCodingAgentMessage(inUse.why),
    };
  }
  const { agent } = inUse;
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
    case "unavailable":
      return {
        agent: engine.agent,
        name: unavailableEngineName(engine.agent),
        caller: { ready: false, reason: engine.reason },
      };
    case "agent":
      return localAgentLlm(engine.agent, engine.models.categorization.model);
  }
}
