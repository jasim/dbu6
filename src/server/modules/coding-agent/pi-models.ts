import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentModel } from "../../../shared/index.js";
import { CODING_AGENT_RUN } from "./agents.js";
import type { InstalledAgent } from "./nuabase.js";

/*
 * The models dbu6 tries for Pi, in preference order, for the prompts handed
 * off from the app. Pi treats its models as `provider/id` names, and which
 * ones answer depends on the providers the user has signed in to, so the list
 * is built per machine rather than fixed:
 *
 *   Pi's configured default (settings.json)
 *   -> DeepSeek Flash -> GLM -> Kimi
 *   -> the ChatGPT-plan models in CODING_AGENT_RUN.pi.models
 *
 * A model is offered only when its provider has credentials in Pi: `pi
 * --list-models` reports the configured set, and the model check (models.ts)
 * is the final word on which of them answer. With no readable settings or
 * model list, every candidate is kept and the check decides.
 */

/** The OpenRouter models dbu6 prefers for Pi, after Pi's own default. */
const PREFERRED_MODELS: readonly AgentModel[] = [
  { model: "~deepseek/deepseek-flash-latest", label: "DeepSeek Flash" },
  { model: "~z-ai/glm-latest", label: "GLM" },
  { model: "~moonshotai/kimi-latest", label: "Kimi" },
];

/** A known model's label, so Pi's default shows as a name it fits. */
function labelFor(model: string): string {
  const known = [...PREFERRED_MODELS, ...CODING_AGENT_RUN.pi.models].find(
    (candidate) => candidate.model === model,
  );
  return known?.label ?? model;
}

/** Pure: the candidates in preference order, first occurrence winning. */
export function piModelOrder(defaultModel: AgentModel | null): AgentModel[] {
  const ordered = [
    ...(defaultModel === null ? [] : [defaultModel]),
    ...PREFERRED_MODELS,
    ...CODING_AGENT_RUN.pi.models,
  ];
  const seen = new Set<string>();
  return ordered.filter((candidate) => {
    if (seen.has(candidate.model)) return false;
    seen.add(candidate.model);
    return true;
  });
}

/**
 * Pure: the model names `pi --list-models` reports, as both `provider/model`
 * and the bare model id, so a candidate that names either form matches.
 * Parses its fixed-width table; the header and blank lines are skipped.
 */
export function parsePiListModels(stdout: string): Set<string> {
  const configured = new Set<string>();
  for (const line of stdout.split("\n")) {
    const [provider, model] = line.trim().split(/\s+/);
    if (provider === undefined || model === undefined) continue;
    if (provider === "provider" || model === "model") continue;
    configured.add(model);
    configured.add(`${provider}/${model}`);
  }
  return configured;
}

/** Pure: the candidates Pi has credentials for, unfiltered when none match. */
export function configuredPiModels(
  candidates: readonly AgentModel[],
  configured: ReadonlySet<string>,
): AgentModel[] {
  const kept = candidates.filter((candidate) =>
    configured.has(candidate.model),
  );
  return kept.length > 0 ? kept : [...candidates];
}

function piAgentDir(): string {
  const fromEnv = process.env.PI_CODING_AGENT_DIR?.trim();
  return fromEnv !== undefined && fromEnv !== ""
    ? fromEnv
    : join(homedir(), ".pi", "agent");
}

/** Pi's configured default model, or null when it has none readable. */
export async function piDefaultModel(): Promise<AgentModel | null> {
  let raw: string;
  try {
    raw = await readFile(join(piAgentDir(), "settings.json"), "utf8");
  } catch {
    return null;
  }
  let settings: { defaultProvider?: unknown; defaultModel?: unknown };
  try {
    settings = JSON.parse(raw) as typeof settings;
  } catch {
    return null;
  }
  const model =
    typeof settings.defaultModel === "string"
      ? settings.defaultModel.trim()
      : "";
  if (model === "") return null;
  const provider =
    typeof settings.defaultProvider === "string"
      ? settings.defaultProvider.trim()
      : "";
  // Pi accepts `provider/id` or a fuzzy id, so leave an id that already names
  // a provider as it is and qualify a bare one with the configured provider.
  const qualified =
    model.includes("/") || provider === "" ? model : `${provider}/${model}`;
  return { model: qualified, label: labelFor(qualified) };
}

// The provider credentials Pi has, or null when its model list can't be read.
async function piConfiguredModels(
  binaryPath: string,
): Promise<ReadonlySet<string> | null> {
  try {
    const { stdout } = await promisify(execFile)(
      binaryPath,
      ["--offline", "--list-models"],
      { timeout: 20_000 },
    );
    return parsePiListModels(stdout);
  } catch {
    return null;
  }
}

/** The models to try for Pi, in preference order, filtered to its logins. */
export async function piModelCandidates(
  agent: InstalledAgent,
): Promise<AgentModel[]> {
  const [defaultModel, configured] = await Promise.all([
    piDefaultModel(),
    piConfiguredModels(agent.binaryPath),
  ]);
  const ordered = piModelOrder(defaultModel);
  return configured === null
    ? ordered
    : configuredPiModels(ordered, configured);
}
