import { Nua } from "nuabase";
import { localAgent } from "nuabase/local-agent";
import {
  CODING_AGENT_LABEL,
  type AgentModel,
  type AgentModels,
  type CodingAgent,
  type UnavailableAgentModel,
} from "dbu6-shared";
import {
  detectCodingAgents,
  type DetectedAgent,
  type InstalledAgent,
} from "./coding-agent.js";

/*
 * The models dbu6 runs each coding agent on: a short list, most capable first,
 * whose last model is the floor. dbu6 never runs an agent on a less capable
 * model, for prompts or for categorization.
 *
 * Which models work depends on the user's login and plan (Codex refuses
 * GPT-5.6 Sol on some ChatGPT accounts), so dbu6 asks each model for a
 * one-word reply:
 *
 * - at startup, for every signed-in agent;
 * - when Settings shows an agent that hasn't been checked;
 * - when a prompt or categorization needs a model and none answered last time
 *   (the agent may be signed in now);
 * - when the user asks again on Settings (a model may have become available).
 *
 * A check where some model answered holds until then. Prompts open on the
 * most capable model that answered, and categorization runs on the least
 * capable, which is faster and cheaper.
 */

const MODELS = {
  "claude-code": [
    { model: "opus", label: "Claude Opus" },
    { model: "sonnet", label: "Claude Sonnet" },
  ],
  codex: [
    { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  ],
} as const satisfies Record<CodingAgent, readonly AgentModel[]>;

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

/**
 * Pure: the agent's own words from a failed call. Nuabase prefixes them with
 * its retries and the CLI's name, and Codex passes on the API's JSON error.
 */
export function failureReason(error: string): string {
  const message = error
    .replace(/^LLM call failed after \d+ attempts\. Last error: /, "")
    .replace(/^(claude|codex): /, "");
  try {
    const inner = (JSON.parse(message) as { error?: { message?: unknown } })
      .error?.message;
    if (typeof inner === "string") return inner;
  } catch {
    // Not JSON: the CLI's own message.
  }
  return message;
}

/** Why an agent none of whose models answered can't be used. */
export function noModelMessage(
  agent: CodingAgent,
  unavailable: readonly UnavailableAgentModel[],
): string {
  const labels = unavailable.map((model) => model.label).join(" or ");
  const floor = unavailable.at(-1);
  const reason = floor === undefined ? "" : ` (${floor.reason})`;
  return `${CODING_AGENT_LABEL[agent]} didn't answer on ${labels}${reason}. See Settings.`;
}

// The part of a nuabase client a check calls. The package's own declarations
// don't resolve under NodeNext (see llm-engine.ts).
type GetResult =
  { success: true; data: unknown } | { success: false; error: string };

const CHECK_PROMPT = "Reply with the single word OK.";
// A model answers in a few seconds; a refused one fails at once, or after
// Nuabase's retries.
const CHECK_TIMEOUT_MS = 60_000;

async function checkModel(
  agent: InstalledAgent,
  model: AgentModel,
): Promise<ModelCheck> {
  try {
    const nua = Nua.direct({
      localAgent: localAgent({
        agent: agent.agent,
        model: model.model,
        binaryPath: agent.binaryPath,
        timeoutMs: CHECK_TIMEOUT_MS,
      }),
    });
    const result: GetResult = await nua.get(CHECK_PROMPT);
    return result.success
      ? { model, answered: true }
      : { model, answered: false, reason: failureReason(result.error) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { model, answered: false, reason };
  }
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
    MODELS[agent.agent].map((model) => checkModel(agent, model)),
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

/** Checks every signed-in agent's models, for startup. */
export async function checkSignedInAgentModels(): Promise<void> {
  const detected = await detectCodingAgents();
  await Promise.all(
    detected
      .filter((status): status is InstalledAgent => status.loggedIn)
      .map(agentModels),
  );
}

function logAgentModels(agent: CodingAgent, models: CheckedAgentModels) {
  const label = CODING_AGENT_LABEL[agent];
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
