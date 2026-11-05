import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  userPrincipal,
  type ProjectDbConnection,
  type SapportaAuthUser,
} from "@sapporta/server";
import type {
  AuthToken,
  CreateAuthTokenBody,
  CreateAuthTokenResponse,
} from "@sapporta/shared/contracts";
import type { AppPrincipal, AppWorkspaceMembership } from "../authz/types.js";
import type { ProjectAuthErrorCode } from "./errors.js";
import {
  findMembership,
  membershipFromRow,
  type WorkspaceMembershipRow,
} from "./workspace.js";

/**
 * Agent access tokens let non-browser clients call the same protected API that
 * a signed-in user can call from the app UI.
 *
 * One token belongs to one user and one workspace in this database. The CLI
 * does not send a workspace id for ordinary data commands; the token selects
 * the workspace. Store only the raw token in a secret manager or agent
 * environment. The database stores a hash of the secret and never returns the
 * raw token again after creation.
 */
const TOKEN_PREFIX = "spat";
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}_([^_]+)_(.+)$`, "i");

interface PersonalAccessTokenRow {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  secret_hash: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

interface TokenUserRow {
  id: string;
  name: string | null;
  email: string;
  email_verified: number;
}

export class TokenAuthError extends Error {
  constructor(readonly code: ProjectAuthErrorCode) {
    super(code);
  }
}

export class TokenManagementError extends Error {
  constructor(readonly code: ProjectAuthErrorCode) {
    super(code);
  }
}

export interface AuthTokenManagementScope {
  userId: string;
  organizationId: string;
}

export interface CreateAuthTokenOptions {
  /** The workspace a token-management route is bound to. */
  scope?: AuthTokenManagementScope;
  /**
   * The job dbu6 mints this token for itself, which makes it dbu6's to
   * replace (`revokeAuthTokensWithPurpose`). The app's token screen sends
   * none: a token a person made is theirs, whatever they named it.
   */
  purpose?: string;
}

/**
 * Whether a request may list, mint or revoke agent access tokens: only from a
 * browser session, never with a token, so a token cannot mint itself more.
 * The token screens' guard and the prompt handoff, which mints one for the
 * project's agent, both ask here.
 */
export function requestMayManageTokens(headers: Headers): boolean {
  return !requestUsesToken(headers);
}

/**
 * Whether a request authenticates with an agent access token rather than a
 * browser session: any non-empty `Authorization` header does. The resolver
 * below reads the request this way, and so does `requestMayManageTokens`, so
 * a guard gets the answer the request was authenticated by. An empty header
 * is no credential, and the session decides.
 */
function requestUsesToken(headers: Headers): boolean {
  return (headers.get("authorization") ?? "") !== "";
}

/**
 * Resolve `Authorization: Bearer spat_<tokenId>_<secret>` into the same user
 * principal shape used by browser sessions.
 *
 * Token failures are intentionally specific enough for automation to recover:
 * expired and revoked tokens can prompt rotation, while `workspace_required`
 * means the user no longer belongs to the workspace named by the token.
 * `lastUsedAt` is updated only after every token, user, and membership check
 * succeeds.
 */
export function resolveBearerTokenPrincipal(
  conn: ProjectDbConnection,
  headers: Headers,
): AppPrincipal | null {
  if (!requestUsesToken(headers)) return null;

  const bearer = (headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!bearer) throw new TokenAuthError("unauthenticated");
  const { token, user, membership } = acceptedToken(conn, bearer[1]);

  markTokenUsed(conn, token.id);
  return userPrincipal({
    user: userFromRow(user),
    membership: membershipFromRow(membership),
  });
}

/**
 * Whom `rawToken` acts for, when this database would accept it now; null
 * otherwise. Nothing is written, not even its `lastUsedAt`, so it works on a
 * database opened read-only.
 */
export function liveTokenPrincipal(
  conn: ProjectDbConnection,
  rawToken: string,
): AppPrincipal | null {
  try {
    const { user, membership } = acceptedToken(conn, rawToken);
    return userPrincipal({
      user: userFromRow(user),
      membership: membershipFromRow(membership),
    });
  } catch (err) {
    if (err instanceof TokenAuthError) return null;
    throw err;
  }
}

/**
 * Whether this database would accept `rawToken` now: the checks a request
 * with it passes, without the request. Its `lastUsedAt` is left as it is,
 * since nothing used it.
 */
export function tokenIsLive(
  conn: ProjectDbConnection,
  rawToken: string,
): boolean {
  try {
    acceptedToken(conn, rawToken);
    return true;
  } catch (err) {
    if (err instanceof TokenAuthError) return false;
    throw err;
  }
}

/**
 * The one statement of what makes a raw `spat_<tokenId>_<secret>` valid, in
 * the order the failures are reported: a known token whose secret matches,
 * not revoked, not expired, for a user who is still a member of the token's
 * workspace.
 */
function acceptedToken(
  conn: ProjectDbConnection,
  rawToken: string,
): {
  token: PersonalAccessTokenRow;
  user: TokenUserRow;
  membership: WorkspaceMembershipRow;
} {
  const parsed = parseToken(rawToken);
  if (!parsed) throw new TokenAuthError("unauthenticated");

  const token = readToken(conn, parsed.id);
  if (!token) throw new TokenAuthError("unauthenticated");
  if (!safeEqual(token.secret_hash, hashSecret(parsed.id, parsed.secret))) {
    throw new TokenAuthError("unauthenticated");
  }
  if (token.revoked_at !== null) throw new TokenAuthError("token_revoked");
  if (token.expires_at !== null && token.expires_at <= Date.now()) {
    throw new TokenAuthError("token_expired");
  }

  const user = readTokenUser(conn, token.user_id);
  if (!user) throw new TokenAuthError("unauthenticated");
  const membership = findMembership(conn, token.user_id, token.organization_id);
  if (!membership) throw new TokenAuthError("workspace_required");
  return { token, user, membership };
}

export function listAuthTokens(
  conn: ProjectDbConnection,
  userId: string,
  organizationId?: string,
): AuthToken[] {
  if (organizationId) {
    return conn.sqlite
      .prepare(
        `
      SELECT
        id,
        userId AS user_id,
        organizationId AS organization_id,
        name,
        secretHash AS secret_hash,
        createdAt AS created_at,
        expiresAt AS expires_at,
        lastUsedAt AS last_used_at,
        revokedAt AS revoked_at
      FROM personalAccessToken
      WHERE userId = ? AND organizationId = ?
      ORDER BY createdAt DESC, id ASC
      `,
      )
      .all(userId, organizationId)
      .map(readTokenRow)
      .filter((row): row is PersonalAccessTokenRow => row !== null)
      .map(serializeToken);
  }

  return conn.sqlite
    .prepare(
      `
      SELECT
        id,
        userId AS user_id,
        organizationId AS organization_id,
        name,
        secretHash AS secret_hash,
        createdAt AS created_at,
        expiresAt AS expires_at,
        lastUsedAt AS last_used_at,
        revokedAt AS revoked_at
      FROM personalAccessToken
      WHERE userId = ?
      ORDER BY createdAt DESC, id ASC
      `,
    )
    .all(userId)
    .map(readTokenRow)
    .filter((row): row is PersonalAccessTokenRow => row !== null)
    .map(serializeToken);
}

/**
 * Create a workspace-scoped token for the signed-in user.
 *
 * Token-management routes pass the current workspace scope. If the request
 * names another workspace, creation is rejected instead of switching scope.
 * The response includes `rawToken` once so the user can copy it into
 * `SAPPORTA_API_TOKEN`; later list calls return metadata only.
 */
export function createAuthToken(
  conn: ProjectDbConnection,
  principal: Extract<AppPrincipal, { kind: "user" }>,
  body: CreateAuthTokenBody,
  { scope, purpose }: CreateAuthTokenOptions = {},
): CreateAuthTokenResponse {
  if (scope && scope.userId !== principal.user.id) {
    throw new TokenManagementError("forbidden");
  }
  if (
    scope &&
    body.organizationId !== undefined &&
    body.organizationId !== scope.organizationId
  ) {
    throw new TokenManagementError("forbidden");
  }
  const organizationId =
    scope?.organizationId ??
    body.organizationId ??
    principal.membership.workspace.id;
  const membership = findMembership(conn, principal.user.id, organizationId);
  if (!membership) throw new TokenManagementError("forbidden");

  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = parseOptionalDate(body.expiresAt);

  conn.sqlite
    .prepare(
      `
      INSERT INTO personalAccessToken (
        id,
        userId,
        organizationId,
        name,
        secretHash,
        createdAt,
        expiresAt,
        lastUsedAt,
        revokedAt,
        purpose
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `,
    )
    .run(
      id,
      principal.user.id,
      membership.organization_id,
      body.name,
      hashSecret(id, secret),
      now,
      expiresAt,
      purpose ?? null,
    );

  const token = readToken(conn, id);
  if (!token) {
    throw new Error("Created agent access token could not be read.");
  }
  return {
    token: serializeToken(token),
    rawToken: `${TOKEN_PREFIX}_${id}_${secret}`,
  };
}

export function revokeAuthToken(
  conn: ProjectDbConnection,
  userId: string,
  tokenId: string,
  organizationId?: string,
): boolean {
  if (organizationId) {
    const result = conn.sqlite
      .prepare(
        `
        UPDATE personalAccessToken
        SET revokedAt = ?
        WHERE id = ? AND userId = ? AND organizationId = ? AND revokedAt IS NULL
        `,
      )
      .run(Date.now(), tokenId, userId, organizationId);
    return result.changes > 0;
  }

  const result = conn.sqlite
    .prepare(
      `
      UPDATE personalAccessToken
      SET revokedAt = ?
      WHERE id = ? AND userId = ? AND revokedAt IS NULL
      `,
    )
    .run(Date.now(), tokenId, userId);
  return result.changes > 0;
}

/**
 * Revokes `userId`'s live tokens in `organizationId` that dbu6 minted for
 * `purpose`, except the one with id `keep`, and returns how many. Tokens with
 * another purpose or none are left alone, whatever they are named.
 */
export function revokeAuthTokensWithPurpose(
  conn: ProjectDbConnection,
  userId: string,
  organizationId: string,
  purpose: string,
  keep: string,
): number {
  return conn.sqlite
    .prepare(
      `
      UPDATE personalAccessToken
      SET revokedAt = ?
      WHERE userId = ? AND organizationId = ? AND purpose = ? AND id <> ?
        AND revokedAt IS NULL
      `,
    )
    .run(Date.now(), userId, organizationId, purpose, keep).changes;
}

/**
 * Token ids are public lookup handles; token secrets are the bearer
 * credentials. Splitting the two lets the server find one row and compare a
 * hash without storing the raw credential.
 */
function parseToken(value: string): { id: string; secret: string } | null {
  const match = value.match(TOKEN_PATTERN);
  if (!match) return null;
  return {
    id: match[1],
    secret: match[2],
  };
}

function hashSecret(id: string, secret: string): string {
  return createHash("sha256").update(`${id}:${secret}`).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function readToken(
  conn: ProjectDbConnection,
  id: string,
): PersonalAccessTokenRow | null {
  return readTokenRow(
    conn.sqlite
      .prepare(
        `
        SELECT
          id,
          userId AS user_id,
          organizationId AS organization_id,
          name,
          secretHash AS secret_hash,
          createdAt AS created_at,
          expiresAt AS expires_at,
          lastUsedAt AS last_used_at,
          revokedAt AS revoked_at
        FROM personalAccessToken
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id),
  );
}

function readTokenUser(
  conn: ProjectDbConnection,
  userId: string,
): TokenUserRow | null {
  const row = conn.sqlite
    .prepare(
      `
      SELECT
        id,
        name,
        email,
        emailVerified AS email_verified
      FROM user
      WHERE id = ?
      LIMIT 1
      `,
    )
    .get(userId);
  if (!isRecord(row)) return null;
  const id = readString(row, "id");
  const email = readString(row, "email");
  const emailVerified = readNumber(row, "email_verified");
  if (!id || !email || emailVerified === null) return null;
  return {
    id,
    name: readNullableString(row, "name"),
    email,
    email_verified: emailVerified,
  };
}

function markTokenUsed(conn: ProjectDbConnection, id: string): void {
  conn.sqlite
    .prepare("UPDATE personalAccessToken SET lastUsedAt = ? WHERE id = ?")
    .run(Date.now(), id);
}

function serializeToken(row: PersonalAccessTokenRow): AuthToken {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    name: row.name,
    createdAt: toIso(row.created_at),
    expiresAt: toNullableIso(row.expires_at),
    lastUsedAt: toNullableIso(row.last_used_at),
    revokedAt: toNullableIso(row.revoked_at),
  };
}

function userFromRow(row: TokenUserRow): SapportaAuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified === 1,
  };
}

function parseOptionalDate(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  return new Date(value).getTime();
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function toNullableIso(value: number | null): string | null {
  return value === null ? null : toIso(value);
}

function readTokenRow(row: unknown): PersonalAccessTokenRow | null {
  if (!isRecord(row)) return null;
  const id = readString(row, "id");
  const userId = readString(row, "user_id");
  const organizationId = readString(row, "organization_id");
  const name = readString(row, "name");
  const secretHash = readString(row, "secret_hash");
  const createdAt = readNumber(row, "created_at");
  if (
    !id ||
    !userId ||
    !organizationId ||
    !name ||
    !secretHash ||
    createdAt === null
  ) {
    return null;
  }
  return {
    id,
    user_id: userId,
    organization_id: organizationId,
    name,
    secret_hash: secretHash,
    created_at: createdAt,
    expires_at: readNullableNumber(row, "expires_at"),
    last_used_at: readNullableNumber(row, "last_used_at"),
    revoked_at: readNullableNumber(row, "revoked_at"),
  };
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : null;
}

function readNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function readNullableNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key];
  return value === null || value === undefined
    ? null
    : typeof value === "number"
      ? value
      : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
