/**
 * `dbu6 agent env`: give this project's coding agents a token, in the one file
 * the shipped `sapporta` command reads.
 *
 * The `sapporta` command finds the app by itself, from the project's
 * `SAPPORTA_API_PORT`, but it needs a `SAPPORTA_API_TOKEN` to act for anyone.
 * The app mints tokens in the browser, one at a time, each shown once; this
 * command does the same thing from the folder, for the agent that is working
 * in it: one token, written to `.env.agent` beside `.env.development` and
 * gitignored, which the `sapporta` bin reads and the server itself does not.
 * The token is minted straight into the database, so no app has to be
 * running.
 *
 * It is also the command the project's AGENTS.md names, so an agent that finds
 * `SAPPORTA_API_TOKEN` missing has a way to provision it that does not involve
 * asking a person to copy a secret into a chat.
 *
 *   dbu6 agent env            write .env.agent, print what to verify with
 *   dbu6 agent env --print    print an `export …` line instead, for `eval`
 *   dbu6 agent env --user <email>   which account, when a project has several
 *
 * Writing is not silent: the file is a credential, so the command says where it
 * put it and what to check, and never prints the token unless asked with
 * `--print`. An older token this command made, by the same name, is revoked
 * once the new one is safely on disk, so a project does not collect one live
 * token per run. `--print` prefers the file the project already has, so it
 * mints nothing in the case it is normally used.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { userPrincipal } from "@sapporta/server";
import {
  createAuthToken,
  findFirstMembership,
  listAuthTokens,
  membershipFromRow,
  revokeAuthToken,
} from "../server/project-auth/index.js";
import { openDbu6Runtime } from "../server/runtime.js";
import { migrateSafely } from "../server/migrate-safely.js";
import { DEMO_ACCOUNT } from "../server/seed/sample-data.js";
import { databaseFile } from "../server/paths.js";
import {
  AGENT_ENV_FILE,
  AGENT_TOKEN_NAME,
  AgentEnvError,
  agentEnvExports,
  agentEnvFile,
  chooseAgentAccount,
  VERIFY_COMMAND,
  type AgentAccount,
} from "./agent-env.js";
import {
  agentEnvPath,
  readAgentEnvValues,
  writeAgentEnvFile,
} from "./agent-file.js";

const USAGE = `Usage: dbu6 agent env [--print] [--user <email>]

  Writes .env.agent in the project, holding SAPPORTA_API_TOKEN for a
  coding agent, and revokes the token an earlier run of this command
  wrote.

  --print          Write the same token as an \`export\` line to stdout
                   instead, for \`eval "$(dbu6 agent env --print)"\`. A
                   project that already has .env.agent gets the token it
                   holds, and nothing is minted; one that does not gets a
                   fresh token, which nothing stores, so a later run of this
                   command revokes it.
  --user <email>   The account the token is for, or its user id when one email
                   is in more than one workspace. Only needed when the project
                   has more than one account.`;

export async function agentCommand(
  args: string[],
  root: string,
): Promise<number> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "env") {
    console.error(
      subcommand === undefined
        ? `dbu6 agent <command>\n\n  env    give this project's coding agents a Sapporta token\n`
        : `Unknown agent command: ${subcommand}\n\n${USAGE}`,
    );
    return 1;
  }

  let parsed: ReturnType<
    typeof parseArgs<{
      options: { user: { type: "string" }; print: { type: "boolean" } };
      allowPositionals: true;
    }>
  >;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        user: { type: "string" },
        print: { type: "boolean", default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 1;
  }
  if (parsed.positionals.length > 0) {
    console.error(USAGE);
    return 1;
  }

  const { user, print } = parsed.values;

  // The token is a row in the books' database, so a database an upgrade left
  // behind is migrated first — the same safety `dbu6 dev` uses, on a verified
  // copy. A project with no database yet says which command makes one.
  if (!existsSync(databaseFile(root))) {
    console.error(
      `No database at ${databaseFile(root)}. Run \`dbu6 dev\` or \`dbu6 migrate\` first.`,
    );
    return 1;
  }
  const migration = await migrateSafely(root);
  if (migration.status === "rejected") {
    console.error(
      `${migration.reason}\nThe database is unchanged; nothing was written.`,
    );
    return 1;
  }

  const runtime = await openDbu6Runtime({ root, sendMail: false });
  try {
    const accounts = agentAccounts(runtime.conn);
    const account = chooseAgentAccount(accounts, {
      user,
      demos: [DEMO_ACCOUNT.email],
    });
    const file = agentEnvPath(root);
    if (print) {
      // The token to export is the one the project already uses: printing it
      // mints nothing, so `eval "$(dbu6 agent env --print)"` cannot leave a
      // trail of live tokens behind.
      const stored = readAgentEnvValues(file);
      if (stored !== null) {
        process.stdout.write(agentEnvExports(stored));
        return 0;
      }
    }

    const membership = findFirstMembership(runtime.conn, account.userId);
    if (membership === null) {
      throw new AgentEnvError(
        `${account.email} is no longer a member of ${account.organizationName}.`,
      );
    }
    const created = createAuthToken(
      runtime.conn,
      userPrincipal({
        user: {
          id: account.userId,
          email: account.email,
          name: account.name,
          emailVerified: true,
        },
        membership: membershipFromRow(membership),
      }),
      {
        name: `${AGENT_TOKEN_NAME} (${new Date().toISOString().slice(0, 10)})`,
      },
    );

    if (print) {
      // Nothing stores this one, so say so: a later run of this command
      // revokes it by name, like any other token this command made.
      process.stderr.write(
        `No ${AGENT_ENV_FILE} in this project, so this token is not stored: run \`dbu6 agent env\` to keep one there.\n`,
      );
      process.stdout.write(agentEnvExports({ apiToken: created.rawToken }));
      return 0;
    }

    writeAgentEnvFile(
      file,
      agentEnvFile({
        apiToken: created.rawToken,
        createdFor: account.email,
      }),
    );
    const revoked = revokeEarlierAgentTokens(
      runtime.conn,
      account,
      created.token.id,
    );

    console.log(
      [
        `Wrote ${AGENT_ENV_FILE} for ${account.email}.`,
        `  token ${created.token.id.slice(0, 8)}… (${AGENT_TOKEN_NAME})`,
        revoked > 0
          ? `  revoked ${revoked} earlier ${AGENT_TOKEN_NAME} token(s)`
          : "",
        "",
        "It is gitignored. The `sapporta` command reads the token from it and",
        "finds the app by itself, so with the app running, verify with, from",
        "this folder:",
        "",
        `  ${VERIFY_COMMAND}`,
        "",
        "That answers with the user and workspace the token acts as.",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    );
    return 0;
  } finally {
    runtime.close();
  }
}

/**
 * Every account that can own a token here: a member of a workspace, with the
 * email and workspace the command reports. The database can hold more than one
 * (a seeded demo account beside the owner's), which is why the choice is made
 * rather than assumed.
 */
function agentAccounts(conn: {
  sqlite: { prepare: (sql: string) => { all: () => unknown[] } };
}): AgentAccount[] {
  const rows = conn.sqlite
    .prepare(
      `
      SELECT
        user.id AS user_id,
        user.email AS email,
        user.name AS name,
        organization.id AS organization_id,
        organization.name AS organization_name
      FROM user
      INNER JOIN member ON member.userId = user.id
      INNER JOIN organization ON organization.id = member.organizationId
      ORDER BY user.createdAt ASC, user.id ASC, member.createdAt ASC
      `,
    )
    .all();
  const accounts: AgentAccount[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const values = row as Record<string, unknown>;
    const fields = [
      values.user_id,
      values.email,
      values.organization_id,
      values.organization_name,
    ];
    if (fields.some((value) => typeof value !== "string")) continue;
    accounts.push({
      userId: values.user_id as string,
      email: values.email as string,
      name: typeof values.name === "string" ? values.name : null,
      organizationId: values.organization_id as string,
      organizationName: values.organization_name as string,
    });
  }
  return accounts;
}

/**
 * Revokes the tokens earlier runs of this command made, once the new one is on
 * disk. Only its own, by name: a token a person made in the app, or one another
 * tool made, is not this command's to revoke.
 */
function revokeEarlierAgentTokens(
  conn: Parameters<typeof listAuthTokens>[0],
  account: AgentAccount,
  keepId: string,
): number {
  let revoked = 0;
  for (const token of listAuthTokens(
    conn,
    account.userId,
    account.organizationId,
  )) {
    if (token.id === keepId) continue;
    if (token.revokedAt !== null) continue;
    if (!token.name.startsWith(AGENT_TOKEN_NAME)) continue;
    if (
      revokeAuthToken(conn, account.userId, token.id, account.organizationId)
    ) {
      revoked += 1;
    }
  }
  return revoked;
}
