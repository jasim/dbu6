import { Nua } from "nuabase";
import {
  agentSessionMode,
  detectLocalAgents,
  localAgent,
  startAgentSession,
  type AgentSessionMode,
  type AgentSessionRefusal,
  type AgentSessionStart,
  type LocalAgentStatus,
} from "nuabase/local-agent";
import { z } from "zod";
import { codingAgentSchema, type CodingAgent } from "../../../shared/index.js";
import type {
  ListAnswer,
  ListClient,
  ListRequest,
} from "../categorization/index.js";
import type {
  GetAnswer,
  GetClient,
  GetRequest,
} from "../chart-of-accounts/index.js";

/*
 * The only module that imports nuabase: every call into it, and what dbu6
 * makes of what it answers.
 *
 * A headless call runs the coding agent's own CLI as a child process, billed
 * to the user's Claude or ChatGPT plan. Every call goes through `Nua.direct`
 * with a local agent, so what dbu6 sends reaches only the agent's own LLM
 * provider, never the Nuabase API. The limits below are dbu6's, not nuabase's
 * defaults.
 *
 * An interactive session is the agent's CLI in a terminal in front of the
 * user (handoff.ts). Nuabase knows each CLI's session options, writes the
 * launcher and opens the terminal; dbu6 decides the agent, model and files.
 */

// One call is one CLI process. A model check asks for one word; a
// categorization call carries up to 50 descriptions (categorization-llm.ts),
// and a chart of accounts is one answer of a hundred or so accounts.
const CALL_TIMEOUT_MS = 180_000;
const CHECK_TIMEOUT_MS = 60_000;
// Agent processes one client runs at once.
const CONCURRENT_CALLS = 2;

// Nuabase logs every call's start and end, usage included, as info. dbu6
// keeps its warnings and errors and logs its own failures (`failed`), so the
// server's log isn't a transcript of LLM calls.
const logger = {
  debug() {},
  info() {},
  warn: (message: string, context?: unknown) =>
    console.warn(`[nuabase] ${message}`, context ?? ""),
  error: (message: string, context?: unknown) =>
    console.error(`[nuabase] ${message}`, context ?? ""),
};

/** What dbu6 reads of nuabase's LocalAgentStatus, for an agent it knows. */
export type DetectedAgent =
  | { agent: CodingAgent; installed: false; loggedIn: false }
  | {
      agent: CodingAgent;
      installed: true;
      loggedIn: boolean;
      binaryPath: string;
    };
export type InstalledAgent = Extract<DetectedAgent, { installed: true }>;

/** A DetectedAgent as dbu_config keeps it (agents.ts). */
export const detectedAgentSchema = z.discriminatedUnion("installed", [
  z.object({
    agent: codingAgentSchema,
    installed: z.literal(false),
    loggedIn: z.literal(false),
  }),
  z.object({
    agent: codingAgentSchema,
    installed: z.literal(true),
    loggedIn: z.boolean(),
    binaryPath: z.string(),
  }),
]);

function isCodingAgent(agent: string): agent is CodingAgent {
  return codingAgentSchema.safeParse(agent).success;
}

function detected(status: LocalAgentStatus & { agent: CodingAgent }) {
  return status.installed
    ? {
        agent: status.agent,
        installed: true as const,
        loggedIn: status.loggedIn,
        binaryPath: status.binaryPath,
      }
    : {
        agent: status.agent,
        installed: false as const,
        loggedIn: false as const,
      };
}

/**
 * Every agent dbu6 knows, in its preference order (Claude Code first), as
 * nuabase found it on this machine. One nuabase didn't report, as a nuabase
 * older than the agent doesn't, is not installed; one dbu6 doesn't know, as a
 * newer nuabase may report, is left out.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const found = (await detectLocalAgents()).flatMap((status) =>
    isCodingAgent(status.agent)
      ? [detected({ ...status, agent: status.agent })]
      : [],
  );
  return codingAgentSchema.options.map(
    (agent): DetectedAgent =>
      found.find((status) => status.agent === agent) ?? {
        agent,
        installed: false,
        loggedIn: false,
      },
  );
}

/** Why nuabase didn't start a session; nothing was written. */
export type SessionRefusal = AgentSessionRefusal;

/** Pure: how a session can start on `platform`; see nuabase's agentSessionMode. */
export function sessionMode(platform: NodeJS.Platform): AgentSessionMode {
  return agentSessionMode(platform);
}

/**
 * Starts the agent on `prompt` in `cwd`, in its auto mode: its reviewer, not
 * the user, approves edits and commands, and stops risky ones. The prompt and
 * its launcher are written to `dir`; on macOS a terminal window opens on it.
 */
export function startSession(session: {
  agent: InstalledAgent;
  /** Undefined runs the agent's own configured default, as Pi's does. */
  model: string | undefined;
  cwd: string;
  prompt: string;
  dir: string;
  platform: NodeJS.Platform;
}): Promise<AgentSessionStart> {
  return startAgentSession({
    agent: session.agent.agent,
    binaryPath: session.agent.binaryPath,
    cwd: session.cwd,
    model: session.model,
    approval: "auto",
    prompt: session.prompt,
    dir: session.dir,
    platform: session.platform,
  });
}

const CHECK_PROMPT = "Reply with the single word OK.";

/** How one of an agent's models fared when asked for a one-word reply. */
export type ModelReply =
  { answered: true } | { answered: false; reason: string };

/**
 * Asks one model of an installed agent whether it answers at all. An undefined
 * model runs the agent's own configured default, as Pi's one candidate does.
 */
export async function askModel(
  agent: InstalledAgent,
  model: string | undefined,
): Promise<ModelReply> {
  try {
    const nua = Nua.direct({
      localAgent: localAgent({
        agent: agent.agent,
        model,
        binaryPath: agent.binaryPath,
        logger,
        timeoutMs: CHECK_TIMEOUT_MS,
      }),
    });
    const reply = await nua.get(CHECK_PROMPT);
    return reply.success
      ? { answered: true }
      : { answered: false, reason: reply.reason };
  } catch (error) {
    return { answered: false, reason: thrownMessage(error) };
  }
}

/** Categorization on one of an installed agent's own models. */
export function agentListClient(
  agent: InstalledAgent,
  model: string | undefined,
): ListClient {
  const nua = Nua.direct({
    localAgent: localAgent({
      agent: agent.agent,
      model,
      binaryPath: agent.binaryPath,
      logger,
      timeoutMs: CALL_TIMEOUT_MS,
      concurrency: CONCURRENT_CALLS,
    }),
  });
  // A local agent takes its own model names only, and this client is already
  // set up with one, so no call names a model.
  return {
    async list(request: ListRequest): Promise<ListAnswer> {
      try {
        const answered = await nua.list(request.prompt, {
          input: [...request.rows],
          primaryKey: "id",
          output: request.output,
        });
        return answered.success
          ? { ok: true, rows: answered.data }
          : failed("list", answered.error, answered.reason);
      } catch (error) {
        return failed("list", thrownMessage(error));
      }
    },
  };
}

/** One structured answer on one of an installed agent's own models. */
export function agentGetClient(
  agent: InstalledAgent,
  model: string | undefined,
): GetClient {
  const nua = Nua.direct({
    localAgent: localAgent({
      agent: agent.agent,
      model,
      binaryPath: agent.binaryPath,
      logger,
      timeoutMs: CALL_TIMEOUT_MS,
      concurrency: CONCURRENT_CALLS,
    }),
  });
  return {
    async get<T>(request: GetRequest<T>): Promise<GetAnswer<T>> {
      let answered;
      try {
        answered = await nua.get(request.prompt, {
          input: request.input,
          output: request.output,
        });
      } catch (error) {
        return failed("get", thrownMessage(error));
      }
      if (!answered.success) {
        return failed("get", answered.error, answered.reason);
      }
      // nuabase checks the answer against the schema's JSON Schema, which
      // runs none of its transforms or refinements; this parse does, and
      // gives the value its type.
      const value = request.output.schema.safeParse(answered.data);
      if (value.success) return { ok: true, value: value.data };
      const issues = value.error.issues
        .map((issue) => `${issue.path.join(".") || "answer"} ${issue.message}`)
        .join("; ");
      return failed("get", `The answer isn't what dbu6 asked for: ${issues}`);
    },
  };
}

// A failed call: nuabase's account of it goes to the log, and the answer
// carries why, fit to show.
function failed(
  call: "get" | "list",
  logged: string,
  reason = logged,
): { ok: false; error: string } {
  console.error(`[nuabase] ${call} call failed:`, logged);
  return { ok: false, error: reportedError(reason) };
}

// nuabase throws only for what dbu6 got wrong, such as an executable it can't
// run; the message says what.
function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MAX_REPORTED_ERROR_LENGTH = 300;

/**
 * Pure: a failure message short enough to show on a screen. An HTML error
 * page is reduced to its title, whitespace is collapsed,
 * and anything past 300 characters is cut.
 */
export function reportedError(message: string): string {
  const title = /<title>([^<]*)<\/title>/i.exec(message)?.[1];
  const text = (title ?? message).replace(/\s+/g, " ").trim();
  return text.length > MAX_REPORTED_ERROR_LENGTH
    ? `${text.slice(0, MAX_REPORTED_ERROR_LENGTH - 1)}…`
    : text;
}
