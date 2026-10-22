import { Nua } from "nuabase";
import {
  agentSessionMode,
  detectLocalAgents,
  fitsAgentSession,
  localAgent,
  openInTerminal,
  writeAgentSession,
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
 * The only module that imports nuabase. Its published declarations don't
 * resolve under NodeNext, so everything it exports typechecks as `any`: the
 * shapes dbu6 relies on are written down once here, and every value that
 * crosses this boundary is parsed or narrowed before the rest of the server
 * sees it.
 *
 * A headless call runs the coding agent's own CLI as a child process, billed
 * to the user's Claude or ChatGPT plan. Every call goes through `Nua.direct`
 * with a local agent, so what dbu6 sends reaches only the agent's own LLM
 * provider, never the Nuabase API. The limits below are dbu6's, not nuabase's
 * defaults.
 *
 * An interactive session is the agent's CLI in a terminal in front of the
 * user (handoff.ts). Nuabase knows each CLI's session options and writes the
 * launcher; dbu6 decides the agent, model, files and when to open it.
 */

// One call is one CLI process. A model check asks for one word; a
// categorization call carries up to 50 descriptions (categorization-llm.ts),
// and a chart of accounts is one answer of a hundred or so accounts.
const CALL_TIMEOUT_MS = 180_000;
const CHECK_TIMEOUT_MS = 60_000;
// Agent processes one client runs at once.
const CONCURRENT_CALLS = 2;

// Nuabase logs every call's start and end, usage included, as info. dbu6
// keeps its warnings and errors and logs its own failures (failedGet,
// failedList), so the server's log isn't a transcript of LLM calls.
const logger = {
  debug() {},
  info() {},
  warn: (message: string, context?: unknown) =>
    console.warn(`[nuabase] ${message}`, context ?? ""),
  error: (message: string, context?: unknown) =>
    console.error(`[nuabase] ${message}`, context ?? ""),
};

/** What dbu6 reads of nuabase's LocalAgentStatus. */
export type DetectedAgent =
  | { agent: CodingAgent; installed: false; loggedIn: false }
  | {
      agent: CodingAgent;
      installed: true;
      loggedIn: boolean;
      binaryPath: string;
    };
export type InstalledAgent = Extract<DetectedAgent, { installed: true }>;

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

const reportedAgentsSchema = z.array(
  z.object({ agent: z.unknown() }).passthrough(),
);

/**
 * Every agent dbu6 knows, in its preference order (Claude Code first), as
 * nuabase found it on this machine. One nuabase didn't report, as a nuabase
 * older than the agent doesn't, is not installed. An agent dbu6 doesn't know
 * is left out rather than carried around as an id nothing else can read; a
 * status dbu6 can't parse throws.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const reported: unknown = await detectLocalAgents();
  const found = reportedAgentsSchema
    .parse(reported)
    .filter((status) => codingAgentSchema.safeParse(status.agent).success)
    .map((status) => detectedAgentSchema.parse(status));
  return codingAgentSchema.options.map(
    (agent): DetectedAgent =>
      found.find((status) => status.agent === agent) ?? {
        agent,
        installed: false,
        loggedIn: false,
      },
  );
}

/** How a session can start on a platform; see nuabase's agentSessionMode. */
export type SessionMode = "terminal" | "command" | "none";

const sessionModeSchema = z.enum(["terminal", "command", "none"]);

/** Pure: how nuabase can start an agent session on `platform`. */
export function sessionMode(platform: NodeJS.Platform): SessionMode {
  return sessionModeSchema.parse(agentSessionMode(platform));
}

/** Pure: whether nuabase's launcher can pass `prompt` on `platform`. */
export function fitsSession(prompt: string, platform: NodeJS.Platform): boolean {
  return z.boolean().parse(fitsAgentSession(prompt, platform));
}

export type SessionFiles = {
  promptPath: string;
  launcherPath: string;
  command: string;
};

const sessionFilesSchema = z.object({
  promptPath: z.string(),
  launcherPath: z.string(),
  command: z.string(),
});

/**
 * Writes the prompt to `<dir>/<name>.md` and a launcher, `<dir>/<name>.command`,
 * that starts the agent on it in `cwd`, in its auto mode: its reviewer, not the
 * user, approves edits and commands, and stops risky ones.
 */
export function writeSession(session: {
  agent: InstalledAgent;
  model: string | undefined;
  cwd: string;
  prompt: string;
  dir: string;
  name: string;
  platform: NodeJS.Platform;
}): SessionFiles {
  return sessionFilesSchema.parse(
    writeAgentSession({
      agent: session.agent.agent,
      binaryPath: session.agent.binaryPath,
      cwd: session.cwd,
      model: session.model,
      approval: "auto",
      prompt: session.prompt,
      dir: session.dir,
      name: session.name,
      platform: session.platform,
    }),
  );
}

/** Runs a launcher in a new window of the user's terminal app (macOS only). */
export async function openSessionInTerminal(
  launcherPath: string,
  platform: NodeJS.Platform,
): Promise<void> {
  await openInTerminal(launcherPath, platform);
}

/**
 * Pure: the agent's own words from a failed call. Nuabase prefixes them with
 * its retries and the CLI's name, and Codex passes on the API's JSON error.
 */
export function llmFailureMessage(error: string): string {
  const message = error
    .replace(/^LLM call failed after \d+ attempts\. Last error: /, "")
    .replace(/^(claude|codex|pi): /, "");
  try {
    const inner = (JSON.parse(message) as { error?: { message?: unknown } })
      .error?.message;
    if (typeof inner === "string") return inner;
  } catch {
    // Not JSON: the CLI's own message.
  }
  return message;
}

// The two calls dbu6 makes on a nuabase client, as the untyped package
// offers them.
type UntypedNua = {
  get(prompt: string, options?: Record<string, unknown>): Promise<unknown>;
  list(prompt: string, options: Record<string, unknown>): Promise<unknown>;
};

// A nuabase answer, of which dbu6 reads whether it succeeded and either the
// rows or the error. `get` answers with one value, `list` with a row each.
const failedAnswerSchema = z.object({
  success: z.literal(false),
  error: z.unknown(),
});
const replySchema = z.union([
  z.object({ success: z.literal(true) }),
  failedAnswerSchema,
]);
const getAnswerSchema = z.union([
  z.object({ success: z.literal(true), data: z.unknown() }),
  failedAnswerSchema,
]);
const listAnswerSchema = z.union([
  z.object({ success: z.literal(true), data: z.array(z.unknown()) }),
  failedAnswerSchema,
]);

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
    const nua: UntypedNua = Nua.direct({
      localAgent: localAgent({
        agent: agent.agent,
        model,
        binaryPath: agent.binaryPath,
        logger,
        timeoutMs: CHECK_TIMEOUT_MS,
      }),
    });
    const parsed = replySchema.safeParse(await nua.get(CHECK_PROMPT));
    if (!parsed.success) {
      return { answered: false, reason: unexpectedShape(parsed.error) };
    }
    return parsed.data.success
      ? { answered: true }
      : {
          answered: false,
          reason: llmFailureMessage(String(parsed.data.error)),
        };
  } catch (error) {
    return {
      answered: false,
      reason: llmFailureMessage(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

/** Categorization on one of an installed agent's own models. */
export function agentListClient(
  agent: InstalledAgent,
  model: string | undefined,
): ListClient {
  const nua: UntypedNua = Nua.direct({
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
      let answered: unknown;
      try {
        answered = await nua.list(request.prompt, {
          input: [...request.rows],
          primaryKey: "id",
          output: request.output,
        });
      } catch (error) {
        return failedList(
          llmFailureMessage(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      const parsed = listAnswerSchema.safeParse(answered);
      if (!parsed.success) {
        return failedList(unexpectedShape(parsed.error));
      }
      return parsed.data.success
        ? { ok: true, rows: parsed.data.data }
        : failedList(llmFailureMessage(String(parsed.data.error)));
    },
  };
}

/** One structured answer on one of an installed agent's own models. */
export function agentGetClient(
  agent: InstalledAgent,
  model: string | undefined,
): GetClient {
  const nua: UntypedNua = Nua.direct({
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
      let answered: unknown;
      try {
        answered = await nua.get(request.prompt, {
          input: request.input,
          output: request.output,
        });
      } catch (error) {
        return failedGet(
          llmFailureMessage(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      const parsed = getAnswerSchema.safeParse(answered);
      if (!parsed.success) return failedGet(unexpectedShape(parsed.error));
      if (!parsed.data.success) {
        return failedGet(llmFailureMessage(String(parsed.data.error)));
      }
      // nuabase checks the answer against the schema too; this is dbu6's
      // own parse, which also gives it its type.
      const value = request.output.schema.safeParse(parsed.data.data);
      return value.success
        ? { ok: true, value: value.data }
        : failedGet(unexpectedShape(value.error));
    },
  };
}

function failedGet(message: string): { ok: false; error: string } {
  console.error("[nuabase] get call failed:", message);
  return { ok: false, error: reportedError(message) };
}

// A failed call: the full message goes to the log, and the answer carries the
// part fit to show.
function failedList(message: string): ListAnswer {
  console.error("[nuabase] list call failed:", message);
  return { ok: false, error: reportedError(message) };
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

function unexpectedShape(error: z.ZodError): string {
  return `nuabase answered in a shape dbu6 doesn't know: ${error.issues
    .map((issue) => `${issue.path.join(".") || "answer"} ${issue.message}`)
    .join("; ")}`;
}
