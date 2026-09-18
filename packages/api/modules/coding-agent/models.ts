import {
  CODING_AGENTS,
  type AgentModel,
  type AgentModels,
  type CodingAgent,
} from "dbu6-shared";
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
 * - at startup, for the agent dbu6 will use;
 * - when Settings shows an agent that hasn't been checked;
 * - when a prompt or categorization needs a model and none answered last time
 *   (the agent may be signed in now);
 * - when the user asks again on Settings (a model may have become available).
 *
 * A check where some model answered holds until then. Prompts open on the most
 * capable model that answered, and categorization runs on the least capable,
 * which is faster and cheaper.
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

type Check = {
  binaryPath: string;
  models: Promise<CheckedAgentModels>;
  /** Null while the check runs. */
  settled: CheckedAgentModels | null;
};

const checks = new Map<CodingAgent, Check>();

// When an agent that was checked is checked again. A running check is always
// shared, and an agent whose executable moved is always checked again.
type Recheck = "never" | "if_unusable" | "always";

function checkModels(
  agent: InstalledAgent,
  recheck: Recheck,
): Promise<CheckedAgentModels> {
  const check = checks.get(agent.agent);
  if (
    check !== undefined &&
    check.binaryPath === agent.binaryPath &&
    (check.settled === null ||
      recheck === "never" ||
      (recheck === "if_unusable" && check.settled.state === "ready"))
  ) {
    return check.models;
  }
  const models = Promise.all(
    CODING_AGENT_RUN[agent.agent].models.map((model) =>
      checkModel(agent, model),
    ),
  ).then(agentModelsFrom);
  const started: Check = {
    binaryPath: agent.binaryPath,
    models,
    settled: null,
  };
  checks.set(agent.agent, started);
  void models.then((settled) => {
    started.settled = settled;
    logAgentModels(agent.agent, settled);
  });
  return models;
}

/**
 * The models to run the agent on, checked first when none answered last time.
 */
export function agentModels(
  agent: InstalledAgent,
): Promise<CheckedAgentModels> {
  return checkModels(agent, "if_unusable");
}

/** Asks the agent's models again, for Settings. */
export function checkAgentModelsAgain(
  agent: InstalledAgent,
): Promise<CheckedAgentModels> {
  return checkModels(agent, "always");
}

/**
 * What Settings shows for an agent's models right now. Starts a check for a
 * signed-in agent that hasn't had one, without waiting for it.
 */
export function agentModelsNow(status: DetectedAgent): AgentModels {
  if (!status.installed || !status.loggedIn) return { state: "not_checked" };
  void checkModels(status, "never");
  return checks.get(status.agent)?.settled ?? { state: "checking" };
}

/**
 * Startup: log the agent dbu6 will use, and ask its models whether they answer,
 * so a prompt or an import doesn't wait for the check. Only that agent is
 * asked: every call a model check costs is billed to the user's plan, and the
 * others are never run until Settings asks about them (agentModelsNow).
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
