/**
 * `dbu6 agent env`: the credentials a coding agent needs, and the file they go
 * in. Everything here is a decision over given values, so the command's own
 * module only has to fetch the account, mint the token and write the file.
 *
 * The token is a person's own agent access token, minted in their database the
 * way the app's token screen mints one. It is written beside `.env` as
 * `.env.agent`, which the shipped `sapporta` bin loads and `dbu6 dev` does not,
 * so the server's own process never holds it. The file is gitignored.
 */

/** The file the agent reads its token from. */
export const AGENT_ENV_FILE = ".env.agent";

/** Where the token comes from, as the project explains it to a person. */
export const AGENT_TOKEN_NAME = "dbu6 agent env";

export interface AgentEnvValues {
  /** The running app the CLI talks to. */
  apiUrl: string;
  /** The raw token, which the database never returns again. */
  apiToken: string;
}

/**
 * The file exactly as it is written. It is a dotenv file like `.env`, and its
 * first lines say where it came from so a person who finds it can tell whether
 * to keep it.
 */
export function agentEnvFile({
  apiUrl,
  apiToken,
  createdFor,
}: AgentEnvValues & { createdFor: string }): string {
  return [
    "# Agent access for coding agents (dbu6). Written by `dbu6 agent env`,",
    "# which the project's AGENTS.md tells an agent to run. Gitignored: this",
    "# file is a credential. Read by the `sapporta` command only.",
    `# Workspace owner: ${createdFor}`,
    "",
    `SAPPORTA_API_URL=${apiUrl}`,
    `SAPPORTA_API_TOKEN=${apiToken}`,
    "",
  ].join("\n");
}

/** The `export …` lines `dbu6 agent env --print` writes, for `eval`. */
export function agentEnvExports({ apiUrl, apiToken }: AgentEnvValues): string {
  return [
    `export SAPPORTA_API_URL=${shellQuote(apiUrl)}`,
    `export SAPPORTA_API_TOKEN=${shellQuote(apiToken)}`,
    "",
  ].join("\n");
}

/**
 * The command that proves the token works, as the documentation prints it.
 * `npx` resolves the project's own `sapporta` bin, which dbu6 ships, so this
 * is right in a folder whose package manager linked nothing else.
 */
export const VERIFY_COMMAND = "npx sapporta api get /api/auth-context";

/** One shell word, whatever the value holds. */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** One account that can own a token: a member of a workspace. */
export interface AgentAccount {
  userId: string;
  email: string;
  name: string | null;
  organizationId: string;
  organizationName: string;
}

export class AgentEnvError extends Error {}

/**
 * Which account the token is for. A books folder is one person's, so the
 * common case has a single account and needs no asking; more than one is
 * reported with the emails, and `--user` picks by email.
 *
 * `demos` are the sample accounts `dbu6 seed` makes. They are real accounts
 * with real tokens, and an agent must not be handed one: its books are
 * replaced by the next `dbu6 seed`.
 */
export function chooseAgentAccount(
  accounts: readonly AgentAccount[],
  options: { user?: string; demos?: readonly string[] } = {},
): AgentAccount {
  const demos = new Set(options.demos ?? []);
  const wanted = options.user?.trim();
  if (wanted !== undefined && wanted !== "") {
    const match = accounts.find(
      (account) => account.email === wanted || account.userId === wanted,
    );
    if (match === undefined) {
      throw new AgentEnvError(
        `No account here has the email ${wanted}. The accounts are:\n` +
          listAccounts(accounts),
      );
    }
    return match;
  }
  const candidates = accounts.filter((account) => !demos.has(account.email));
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new AgentEnvError(
      accounts.length === 0
        ? "This project has no account yet. Open the app, sign up, then run this again."
        : `This project has only sample accounts (${accounts.map((account) => account.email).join(", ")}). Sign up in the app and run this again.`,
    );
  }
  throw new AgentEnvError(
    `This project has more than one account, so say which one the agent is for:\n` +
      `${listAccounts(candidates)}\n` +
      "Run this again with `--user <email>`.",
  );
}

function listAccounts(accounts: readonly AgentAccount[]): string {
  return accounts
    .map(
      (account) =>
        `  ${account.email}${account.name ? ` (${account.name})` : ""} — ${account.organizationName}`,
    )
    .join("\n");
}
