import { randomUUID } from "node:crypto";
import type { ProjectDbConnection } from "@sapporta/server";
import { parseTimeZone, type TimeZone } from "@sapporta/shared/temporal";
import type { AppWorkspaceMembership } from "../authz/types.js";
import type { BetterAuthSessionPayload } from "./context.js";

export interface WorkspaceMembershipRow {
  member_id: string;
  role: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_time_zone: string;
}

export class WorkspaceSwitchError extends Error {
  readonly code = "forbidden";
  readonly status = 403;
}

export function ensureActiveWorkspace(
  conn: ProjectDbConnection,
  payload: BetterAuthSessionPayload,
): WorkspaceMembershipRow {
  const activeWorkspaceId = payload.session.activeOrganizationId ?? null;
  if (activeWorkspaceId) {
    const membership = findMembership(conn, payload.user.id, activeWorkspaceId);
    if (membership) return membership;
  }

  const firstMembership = findFirstMembership(conn, payload.user.id);
  if (firstMembership) {
    setActiveWorkspace(
      conn,
      payload.session.id,
      firstMembership.organization_id,
    );
    payload.session.activeOrganizationId = firstMembership.organization_id;
    return firstMembership;
  }

  const provisioned = createInitialWorkspace(conn, payload.user);
  setActiveWorkspace(conn, payload.session.id, provisioned.organization_id);
  payload.session.activeOrganizationId = provisioned.organization_id;
  return provisioned;
}

export function switchWorkspaceMembership(
  conn: ProjectDbConnection,
  payload: BetterAuthSessionPayload,
  workspaceId: string,
): WorkspaceMembershipRow {
  const membership = findMembership(conn, payload.user.id, workspaceId);
  if (!membership) {
    throw new WorkspaceSwitchError("You are not a member of that workspace.");
  }
  setActiveWorkspace(conn, payload.session.id, workspaceId);
  payload.session.activeOrganizationId = workspaceId;
  return membership;
}

export function findMembership(
  conn: ProjectDbConnection,
  userId: string,
  organizationId: string,
): WorkspaceMembershipRow | null {
  return readMembership(
    conn.sqlite
      .prepare(
        `
        SELECT
          member.id AS member_id,
          member.role AS role,
          organization.id AS organization_id,
          organization.name AS organization_name,
          organization.slug AS organization_slug,
          organization.timeZone AS organization_time_zone
        FROM member
        INNER JOIN organization ON organization.id = member.organizationId
        WHERE member.userId = ? AND member.organizationId = ?
        LIMIT 1
        `,
      )
      .get(userId, organizationId),
  );
}

export function findFirstMembership(
  conn: ProjectDbConnection,
  userId: string,
): WorkspaceMembershipRow | null {
  return readMembership(
    conn.sqlite
      .prepare(
        `
        SELECT
          member.id AS member_id,
          member.role AS role,
          organization.id AS organization_id,
          organization.name AS organization_name,
          organization.slug AS organization_slug,
          organization.timeZone AS organization_time_zone
        FROM member
        INNER JOIN organization ON organization.id = member.organizationId
        WHERE member.userId = ?
        ORDER BY member.createdAt ASC, member.id ASC
        LIMIT 1
        `,
      )
      .get(userId),
  );
}

export function createInitialWorkspace(
  conn: ProjectDbConnection,
  user: BetterAuthSessionPayload["user"],
): WorkspaceMembershipRow {
  const now = unixTimestamp();
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const name = workspaceName(user);
  const slug = uniqueWorkspaceSlug(conn, name);
  const timeZone = accountTimeZone(conn, user.id);

  conn.sqlite
    .prepare(
      `
      INSERT INTO organization (id, name, slug, logo, createdAt, metadata, timeZone)
      VALUES (?, ?, ?, NULL, ?, NULL, ?)
      `,
    )
    .run(organizationId, name, slug, now, timeZone);
  conn.sqlite
    .prepare(
      `
      INSERT INTO member (id, organizationId, userId, role, createdAt)
      VALUES (?, ?, ?, 'owner', ?)
      `,
    )
    .run(memberId, organizationId, user.id, now);

  return {
    member_id: memberId,
    role: "owner",
    organization_id: organizationId,
    organization_name: name,
    organization_slug: slug,
    organization_time_zone: timeZone,
  };
}

/**
 * The calendar this account keeps, which the workspace it is about to get
 * starts on.
 *
 * The browser sends it with the sign-up request, so it is the zone the person
 * creating the workspace was actually in — which is almost always the calendar
 * they want it kept in. It is a starting value and not a preference: it is
 * copied onto the workspace row here and never consulted again, and from then
 * on the workspace owns its own calendar and changes it on the workspace
 * settings screen.
 */
function accountTimeZone(conn: ProjectDbConnection, userId: string): string {
  const row = conn.sqlite
    .prepare('SELECT timeZone FROM "user" WHERE id = ?')
    .get(userId);
  if (!isRecord(row)) {
    throw new Error(`No account row for user ${userId}.`);
  }
  const timeZone = readString(row, "timeZone");
  if (!timeZone) {
    throw new Error(`Account ${userId} has no time zone.`);
  }
  return timeZone;
}

/**
 * Converts the selected workspace membership into request facts.
 *
 * Roles live on the membership, not the user. The same person can be an owner
 * in one workspace and a member in another, and agent access tokens preserve
 * that distinction because each token names one workspace.
 *
 * The time zone is checked here, where the row is read, so everything
 * downstream holds a zone this runtime can render rather than a string that
 * might not be one. A stored id this runtime cannot use — a zone renamed out
 * from under the row by a tz database update — fails the request with the
 * workspace and the bad value named, instead of surfacing inside a cell
 * renderer with nowhere to report it.
 */
export function membershipFromRow(
  row: WorkspaceMembershipRow,
): AppWorkspaceMembership {
  const role =
    row.role === "owner" || row.role === "admin" ? "owner" : "member";
  return {
    id: row.member_id,
    workspace: {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      timeZone: workspaceTimeZoneFromRow(row),
    },
    roles: [role],
  };
}

function workspaceTimeZoneFromRow(row: WorkspaceMembershipRow): TimeZone {
  try {
    return parseTimeZone(row.organization_time_zone);
  } catch (err) {
    throw new Error(
      `Workspace ${row.organization_id} has a time zone this runtime cannot ` +
        `use: ${JSON.stringify(row.organization_time_zone)}. ` +
        `Set a current IANA id on the workspace settings screen.`,
      { cause: err },
    );
  }
}

/**
 * Changes the calendar this workspace keeps.
 *
 * The zone is already checked by the route that calls this, so what is stored
 * is an id this server's tz database knows.
 */
export function setWorkspaceTimeZone(
  conn: ProjectDbConnection,
  workspaceId: string,
  timeZone: TimeZone,
): void {
  conn.sqlite
    .prepare("UPDATE organization SET timeZone = ? WHERE id = ?")
    .run(timeZone, workspaceId);
}

export function setActiveWorkspace(
  conn: ProjectDbConnection,
  sessionId: string,
  workspaceId: string,
): void {
  conn.sqlite
    .prepare(
      `
      UPDATE session
      SET activeOrganizationId = ?, updatedAt = ?
      WHERE id = ?
      `,
    )
    .run(workspaceId, unixTimestamp(), sessionId);
}

function uniqueWorkspaceSlug(conn: ProjectDbConnection, name: string): string {
  const base = slugify(name) || "workspace";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = `${base}${suffix}`;
    if (!workspaceSlugExists(conn, candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function workspaceSlugExists(conn: ProjectDbConnection, slug: string): boolean {
  const row = conn.sqlite
    .prepare("SELECT 1 AS found FROM organization WHERE slug = ? LIMIT 1")
    .get(slug);
  return row !== undefined;
}

function workspaceName(user: BetterAuthSessionPayload["user"]): string {
  const trimmedName = user.name?.trim();
  if (trimmedName) return `${trimmedName}'s Workspace`;
  return `${user.email.split("@")[0]}'s Workspace`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function readMembership(row: unknown): WorkspaceMembershipRow | null {
  if (!isRecord(row)) return null;
  const memberId = readString(row, "member_id");
  const role = readString(row, "role");
  const organizationId = readString(row, "organization_id");
  const organizationName = readString(row, "organization_name");
  const organizationSlug = readString(row, "organization_slug");
  const organizationTimeZone = readString(row, "organization_time_zone");
  if (
    !memberId ||
    !role ||
    !organizationId ||
    !organizationName ||
    !organizationSlug ||
    !organizationTimeZone
  ) {
    return null;
  }
  return {
    member_id: memberId,
    role,
    organization_id: organizationId,
    organization_name: organizationName,
    organization_slug: organizationSlug,
    organization_time_zone: organizationTimeZone,
  };
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
