import { z } from "zod";
import {
  agentModelsSchema,
  CODING_AGENTS,
  codingAgentInUse,
  noCodingAgentMessage,
  type AgentModel,
  type AgentModels,
  type CodingAgent,
  type AgentInUse,
} from "../../../shared/index.js";
import { readDbuConfig, writeDbuConfig } from "../../dbu-config.js";
import {
  chosenCodingAgent,
  CODING_AGENT_RUN,
  codingAgents,
  installedCodingAgents,
  saveChosenCodingAgent,
} from "./agents.js";
import {
  askModel,
  type DetectedAgent,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Which of an agent's models answer on this machine's login. The candidates
 * are the agent's list (agents.ts); Pi's is its one configured default. Codex
 * refuses GPT-5.6 Sol on some ChatGPT accounts, so dbu6 asks each candidate
 * for a one-word reply:
 *
 * - at startup, for the agent dbu6 will use, when it has no check yet;
 * - with no agent chosen, for each installed agent in turn until one answers,
 *   which dbu6 then saves as the choice (pickCodingAgent);
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

let picking: Promise<void> | null = null;

/** dbu6 is trying the agents to pick one, for Settings. */
export function pickingCodingAgent(): boolean {
  return picking !== null;
}

/**
 * With no agent chosen, tries the installed ones in order, Claude Code first,
 * and saves the first that is signed in and has a model that answers as the
 * choice. They are asked one at a time, so no agent after the one that works
 * is asked: each check is billed to the user's plan. A choice made while the
 * pick runs is kept, and when none works, nothing is chosen. Callers during a
 * pick share it. A pick asks only agents with no stored check, so running it
 * again is quiet and free until the checks are forgotten (Settings).
 */
export function pickCodingAgent(): Promise<void> {
  picking ??= pickFirstThatWorks().finally(() => {
    picking = null;
  });
  return picking;
}

async function pickFirstThatWorks(): Promise<void> {
  if ((await chosenCodingAgent()) !== null) return;
  for (const agent of installedCodingAgents(await codingAgents())) {
    if (!agent.loggedIn) continue;
    if ((await agentModels(agent)).state !== "ready") continue;
    if ((await chosenCodingAgent()) === null) {
      await saveChosenCodingAgent(agent.agent);
      console.log(
        `[coding-agent] chose ${CODING_AGENTS[agent.agent].label}, the first agent that works (saved in user-config/settings.json)`,
      );
    }
    return;
  }
}

/**
 * The agent dbu6 uses right now: the chosen one, even when it doesn't work,
 * so it is never swapped for another behind the user's back. With none
 * chosen, picks one first.
 */
export async function currentCodingAgent(): Promise<AgentInUse<DetectedAgent>> {
  if ((await chosenCodingAgent()) === null) await pickCodingAgent();
  const [detected, chosen] = await Promise.all([
    codingAgents(),
    chosenCodingAgent(),
  ]);
  return codingAgentInUse(detected, chosen);
}

/**
 * Startup: pick an agent when none is chosen, log the one dbu6 will use, and
 * when nothing is stored yet, ask its models whether they answer, so a prompt
 * or an import doesn't wait for the check. What is stored is used as it is:
 * only Settings detects again. Only the agent dbu6 uses, or with none chosen
 * the agents up to the first that works, are asked: every call a model check
 * costs is billed to the user's plan, and the others are never run until
 * Settings asks about them (agentModelsNow).
 */
export async function startCodingAgent(): Promise<void> {
  const inUse = await currentCodingAgent();
  logCodingAgent(inUse);
  if (inUse.agent?.loggedIn) await agentModels(inUse.agent);
}

function logCodingAgent(inUse: AgentInUse<DetectedAgent>): void {
  console.log(
    inUse.agent === null
      ? `[coding-agent] ${noCodingAgentMessage(inUse.why)} Categorization and agent prompts are off.`
      : `[coding-agent] using ${CODING_AGENTS[inUse.agent.agent].label} (${inUse.agent.binaryPath})`,
  );
}

function logAgentModels(agent: CodingAgent, models: CheckedAgentModels) {
  const label = CODING_AGENTS[agent].label;
  const unavailable = models.unavailable
    .map((model) => `${model.label} didn't answer (${model.reason})`)
    .join("; ");
  if (models.state === "no_model") {
    console.log(`[coding-agent] ${label}: no model answered: ${unavailable}`);
    return;
  }
  console.log(
    `[coding-agent] ${label}: prompts open on ${models.session.label}, categorization runs on ${models.categorization.label}${unavailable && `; ${unavailable}`}`,
  );
}
