import { z } from "zod";
import {
  agentModelsSchema,
  CODING_AGENTS,
  type AgentModel,
  type AgentModels,
  type CodingAgent,
} from "../../../shared/index.js";
import { readDbuConfig, writeDbuConfig } from "../../dbu-config.js";
import {
  CODING_AGENT_RUN,
  currentCodingAgent,
  logCodingAgent,
} from "./agents.js";
import {
  askModel,
  type DetectedAgent,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Which of an agent's models (agents.ts) answer on this machine's login.
 * Codex refuses GPT-5.6 Sol on some ChatGPT accounts, so dbu6 asks each model
 * for a one-word reply:
 *
 * - at startup, for the agent dbu6 will use, when it has no check yet;
 * - when Settings shows a signed-in agent that has no check yet;
 * - when the user asks again on Settings (an agent may be signed in now, or a
 *   model may have become available).
 *
 * A check is kept in dbu_config across restarts, and holds until the user asks
 * again. Prompts open on the most capable model that answered, and
 * categorization runs on the least capable, which is faster and cheaper.
 */

/** How one model fared when asked for a reply. */
export type ModelCheck =
  | { model: AgentModel; answered: true }
  | { model: AgentModel; answered: false; reason: string };

/** An agent's models once checked. */
export type CheckedAgentModels = Extract<
  AgentModels,
  { state: "ready" | "no_model" }
>;

/** Pure: what an agent runs on, from its models' checks, most capable first. */
export function agentModelsFrom(
  checks: readonly ModelCheck[],
): CheckedAgentModels {
  const answered = checks.flatMap((check) =>
    check.answered ? [check.model] : [],
  );
  const unavailable = checks.flatMap((check) =>
    check.answered ? [] : [{ ...check.model, reason: check.reason }],
  );
  const session = answered[0];
  const categorization = answered.at(-1);
  if (session === undefined || categorization === undefined) {
    return { state: "no_model", unavailable };
  }
  return { state: "ready", session, categorization, unavailable };
}

async function checkModel(
  agent: InstalledAgent,
  model: AgentModel,
): Promise<ModelCheck> {
  const reply = await askModel(agent, model.model);
  return reply.answered
    ? { model, answered: true }
    : { model, answered: false, reason: reply.reason };
}

// A model check kept in dbu_config, for the executable it ran on.
const storedCheckSchema = z.object({
  binaryPath: z.string(),
  models: agentModelsSchema,
});
const storedChecksSchema = z.record(z.string(), storedCheckSchema);
type StoredChecks = z.infer<typeof storedChecksSchema>;

function storedChecks(): StoredChecks {
  return readDbuConfig("coding_agent.models", storedChecksSchema) ?? {};
}

// The agent's last check, unless its executable has moved since.
function storedCheck(agent: InstalledAgent): CheckedAgentModels | null {
  const stored = storedChecks()[agent.agent];
  if (stored?.binaryPath !== agent.binaryPath) return null;
  const { models } = stored;
  return models.state === "ready" || models.state === "no_model"
    ? models
    : null;
}

function storeCheck(agent: InstalledAgent, models: CheckedAgentModels): void {
  writeDbuConfig("coding_agent.models", {
    ...storedChecks(),
    [agent.agent]: { binaryPath: agent.binaryPath, models },
  });
}

/** Forgets every agent's check, so each is asked again when next needed. */
export function forgetAgentModels(): void {
  writeDbuConfig("coding_agent.models", {});
}

type Running = { binaryPath: string; models: Promise<CheckedAgentModels> };

// Checks under way; callers during one share it.
const running = new Map<CodingAgent, Running>();

function runningCheck(agent: InstalledAgent): Running | undefined {
  const check = running.get(agent.agent);
  return check?.binaryPath === agent.binaryPath ? check : undefined;
}

function checkModels(
  agent: InstalledAgent,
  again: boolean,
): Promise<CheckedAgentModels> {
  const underWay = runningCheck(agent);
  if (underWay !== undefined) return underWay.models;
  const stored = again ? null : storedCheck(agent);
  if (stored !== null) return Promise.resolve(stored);
  const models = Promise.all(
    CODING_AGENT_RUN[agent.agent].models.map((model) =>
      checkModel(agent, model),
    ),
  ).then(agentModelsFrom);
  const started: Running = { binaryPath: agent.binaryPath, models };
  running.set(agent.agent, started);
  void models.then((settled) => {
    storeCheck(agent, settled);
    if (running.get(agent.agent) === started) running.delete(agent.agent);
    logAgentModels(agent.agent, settled);
  });
  return models;
}

/**
 * The models to run the agent on: its last check, or a check now when it has
 * none.
 */
export function agentModels(
  agent: InstalledAgent,
): Promise<CheckedAgentModels> {
  return checkModels(agent, false);
}

/** Asks the agent's models again, for Settings. */
export function checkAgentModelsAgain(
  agent: InstalledAgent,
): Promise<CheckedAgentModels> {
  return checkModels(agent, true);
}

/**
 * What Settings shows for an agent's models right now. Starts a check for a
 * signed-in agent that hasn't had one, without waiting for it.
 */
export function agentModelsNow(status: DetectedAgent): AgentModels {
  if (!status.installed || !status.loggedIn) return { state: "not_checked" };
  if (runningCheck(status) !== undefined) return { state: "checking" };
  const stored = storedCheck(status);
  if (stored !== null) return stored;
  void checkModels(status, false);
  return { state: "checking" };
}

/**
 * Startup: log the agent dbu6 will use, and when nothing is stored yet, detect
 * the agents and ask that agent's models whether they answer, so a prompt or
 * an import doesn't wait for the check. What is stored is used as it is: only
 * Settings detects again. Only the agent dbu6 uses is asked: every call a
 * model check costs is billed to the user's plan, and the others are never run
 * until Settings asks about them (agentModelsNow).
 */
export async function startCodingAgent(): Promise<void> {
  const agent = await currentCodingAgent();
  logCodingAgent(agent);
  if (agent?.loggedIn) await agentModels(agent);
}

function logAgentModels(agent: CodingAgent, models: CheckedAgentModels) {
  const label = CODING_AGENTS[agent].label;
  const unavailable = models.unavailable
    .map((model) => `${model.model} didn't answer (${model.reason})`)
    .join("; ");
  if (models.state === "no_model") {
    console.warn(`[coding-agent] ${label} can't be used: ${unavailable}`);
    return;
  }
  console.log(
    `[coding-agent] ${label}: prompts open on ${models.session.model}, categorization runs on ${models.categorization.model}${unavailable && `; ${unavailable}`}`,
  );
}
