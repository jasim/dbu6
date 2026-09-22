import { Nua } from "nuabase";
import { detectLocalAgents, localAgent } from "nuabase/local-agent";
import { z } from "zod";
import { codingAgentSchema, type CodingAgent } from "../../../shared/index.js";
import type {
  ListAnswer,
  ListClient,
  ListRequest,
} from "../categorization/index.js";

/*
 * The only module that imports nuabase. Its published declarations don't
 * resolve under NodeNext, so everything it exports typechecks as `any`: the
 * shapes dbu6 relies on are written down once here, and every value that
 * crosses this boundary is parsed or narrowed before the rest of the server
 * sees it.
 *
 * A headless call runs the coding agent's own CLI as a child process, billed
 * to the user's Claude or ChatGPT plan. The limits below are dbu6's, not
 * nuabase's defaults.
 */

// One call is one CLI process. A model check asks for one word; a
// categorization call carries up to 50 descriptions (categorization-llm.ts).
const CALL_TIMEOUT_MS = 180_000;
const CHECK_TIMEOUT_MS = 60_000;
// Agent processes one client runs at once.
const CONCURRENT_CALLS = 2;

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

const detectedAgentSchema = z.discriminatedUnion("installed", [
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
 * The agents nuabase found on this machine, in its preference order (Claude
 * Code first). An agent dbu6 doesn't know is left out rather than carried
 * around as an id nothing else can read; a status dbu6 can't parse throws.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const reported: unknown = await detectLocalAgents();
  return reportedAgentsSchema
    .parse(reported)
    .filter((status) => codingAgentSchema.safeParse(status.agent).success)
    .map((status) => detectedAgentSchema.parse(status));
}

/**
 * Pure: the agent's own words from a failed call. Nuabase prefixes them with
 * its retries and the CLI's name, and Codex passes on the API's JSON error.
 */
export function llmFailureMessage(error: string): string {
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

// The two calls dbu6 makes on a nuabase client, as the untyped package
// offers them.
type UntypedNua = {
  get(prompt: string): Promise<unknown>;
  list(prompt: string, options: Record<string, unknown>): Promise<unknown>;
};

type ProviderModel = { provider: string; model: string };

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
const listAnswerSchema = z.union([
  z.object({ success: z.literal(true), data: z.array(z.unknown()) }),
  failedAnswerSchema,
]);

const CHECK_PROMPT = "Reply with the single word OK.";

/** How one of an agent's models fared when asked for a one-word reply. */
export type ModelReply =
  { answered: true } | { answered: false; reason: string };

/** Asks one model of an installed agent whether it answers at all. */
export async function askModel(
  agent: InstalledAgent,
  model: string,
): Promise<ModelReply> {
  try {
    const nua: UntypedNua = Nua.direct({
      localAgent: localAgent({
        agent: agent.agent,
        model,
        binaryPath: agent.binaryPath,
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
  model: string,
): ListClient {
  const nua: UntypedNua = Nua.direct({
    localAgent: localAgent({
      agent: agent.agent,
      model,
      binaryPath: agent.binaryPath,
      timeoutMs: CALL_TIMEOUT_MS,
      concurrency: CONCURRENT_CALLS,
    }),
  });
  // A local agent takes its own model names only, and this client is already
  // set up with one, so no call names a model.
  return listClient(nua, undefined);
}

/** Categorization on the deprecated Nuabase gateway, on a provider model. */
export function gatewayListClient(
  apiKey: string,
  model: ProviderModel,
): ListClient {
  const nua: UntypedNua = Nua.gateway({ apiKey });
  return listClient(nua, model);
}

function listClient(
  nua: UntypedNua,
  model: ProviderModel | undefined,
): ListClient {
  return {
    async list(request: ListRequest): Promise<ListAnswer> {
      let answered: unknown;
      try {
        answered = await nua.list(request.prompt, {
          input: [...request.rows],
          primaryKey: "id",
          output: request.output,
          ...(model === undefined ? {} : { model }),
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

// A failed call: the full message goes to the log, and the answer carries the
// part fit to show.
function failedList(message: string): ListAnswer {
  console.error("[nuabase] list call failed:", message);
  return { ok: false, error: reportedError(message) };
}

const MAX_REPORTED_ERROR_LENGTH = 300;

/**
 * Pure: a failure message short enough to show on a screen. An HTML error
 * page (a gateway's 500) is reduced to its title, whitespace is collapsed,
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
