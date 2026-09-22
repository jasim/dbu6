/**
 * Additions only: a project's report or `extend` may add routes, and a route
 * of ours that it names again is an error, not a replacement. Hono would
 * otherwise keep both and answer with whichever was registered first, so the
 * project's handler would silently never run.
 */
import type { Hono } from "hono";
import type { SapportaEnv } from "@sapporta/server";

type Routes = Pick<Hono<SapportaEnv>, "routes">;

/**
 * Runs `add`, which registers routes on `target`, and throws when one of them
 * has the method and path of a route in `existing` or of an earlier route on
 * `target`. `prefix` is where `target` is mounted, so its paths compare with
 * `existing`'s. Middleware (`use`, method ALL) is not a route and is skipped.
 */
export async function addRoutesWithoutCollision(options: {
  target: Routes;
  prefix: string;
  existing: Routes;
  /** Whose routes these are, for the message: the file that adds them. */
  source: string;
  add: () => void | Promise<void>;
}): Promise<void> {
  const { target, prefix, existing, source, add } = options;
  const taken = new Set([
    ...existing.routes.map((route) => routeKey(route.method, route.path)),
    ...target.routes.map((route) =>
      routeKey(route.method, joinPath(prefix, route.path)),
    ),
  ]);
  const before = target.routes.length;
  await add();
  for (const route of target.routes.slice(before)) {
    if (route.method === "ALL") continue;
    const key = routeKey(route.method, joinPath(prefix, route.path));
    if (taken.has(key)) {
      throw new Error(
        `${source} adds the route ${key}, which already exists. ` +
          `A project can add routes but not replace one: give it another path.`,
      );
    }
    taken.add(key);
  }
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function joinPath(prefix: string, path: string): string {
  const joined = `${prefix.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}
