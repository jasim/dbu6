import { organization } from "better-auth/plugins";

export const projectAuthBasePath = "/api/auth";

export const projectAuthDrizzleAdapterConfig = {
  provider: "sqlite",
  camelCase: true,
} as const;

export function createProjectAuthEmailAndPasswordOptions(
  requireEmailVerification: boolean,
  sendResetPassword: (data: {
    user: { email: string; name?: string | null };
    url: string;
    token: string;
  }) => Promise<void>,
) {
  return {
    enabled: true,
    requireEmailVerification,
    sendResetPassword,
  };
}

/**
 * The account fields this project keeps beyond Better Auth's own.
 *
 * `timeZone` is the calendar the person signing up keeps, sent by the browser
 * with the sign-up request. It is the value the first workspace this account
 * creates starts on, and that is the whole of its job: nothing displays it and
 * nothing groups by it, because a day belongs to the workspace's calendar
 * rather than to any one reader's. It is required, so an account cannot come
 * into being without one and no workspace has to guess.
 *
 * Deliberately no `defaultValue` here, even though the column it maps to
 * carries one: a default on this field is what Better Auth falls back to
 * instead of rejecting the request, so a sign-up that forgot to send a zone
 * would quietly take the fallback instead of being told. The column's default
 * exists for a different reason — see `user.timeZone` in `schema.ts` — and is
 * reached only by rows this application did not create.
 */
export const projectAuthUserOptions = {
  additionalFields: {
    timeZone: {
      type: "string",
      required: true,
      input: true,
    },
  },
} as const;

export function createProjectAuthPlugins() {
  return [
    organization({
      schema: {
        organization: {
          additionalFields: {
            /**
             * The zone this workspace reads and groups days in, as an IANA id.
             *
             * An id rather than a fixed offset: an offset such as `+05:30`
             * describes one instant, and a report describes a range that can
             * contain the moment the offset changes. An id also survives a tz
             * rule change, which a number does not.
             *
             * Not nullable and with no "automatic" state: a workspace whose
             * zone were unset would make every day-grouped number ambiguous,
             * and there is no sensible fallback — the server's `TZ` is an
             * accident of deployment and the reader's browser is the
             * per-reader answer a workspace calendar exists to replace.
             *
             * The default is `Asia/Calcutta` rather than the framework
             * template's `UTC`, because these books are kept on that calendar
             * and always have been. A workspace arriving without a zone is
             * not something the app can produce — sign-up sends the browser's
             * and `createInitialWorkspace` passes the account's — so this is
             * reached only from outside it: a seed script, an import, a row
             * written by hand. UTC there would not be neutral, it would be
             * 5.5 hours wrong, and wrong in the direction that silently moves
             * entries made after 18:30 IST onto the next day.
             */
            timeZone: {
              type: "string",
              required: true,
              defaultValue: "Asia/Calcutta",
              input: false,
            },
          },
        },
      },
    }),
  ];
}
