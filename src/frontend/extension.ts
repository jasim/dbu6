import type { ComponentType } from "react";
import type { ReportDefinition } from "./reports/registry";
import type { NavigationItem } from "./shell/navigation";

/** A page of the user's own, shown inside the signed-in app shell. */
export interface Dbu6Page {
  /** The path under the app's root, such as `goals` or `goals/:goalId`. */
  path: string;
  Component: ComponentType;
}

/**
 * What a project adds to the frontend. Everything is added: a report id, a
 * path or a navigation target dbu6 already has is an error that names it.
 *
 * The host fills `reports` from the project's `reports/<id>/report.ts` files and
 * takes `routes` and `navigation` from the default export of `frontend.tsx`.
 */
export interface Dbu6FrontendExtension {
  reports?: readonly ReportDefinition[];
  routes?: readonly Dbu6Page[];
  /** Sidebar entries, listed after dbu6's own. */
  navigation?: readonly NavigationItem[];
}

/**
 * Throws when `added` repeats a key of `existing` or one of its own, naming
 * it. `what` words the message: "A report with the id", "A page with the path".
 */
export function assertNoneTaken(
  what: string,
  existing: Iterable<string>,
  added: readonly string[],
): void {
  const taken = new Set(existing);
  for (const key of added) {
    if (taken.has(key)) {
      throw new Error(
        `${what} "${key}" already exists. dbu6 adds what a project ` +
          `defines and replaces nothing, so give yours another one.`,
      );
    }
    taken.add(key);
  }
}

/** A route path as the router compares it: no slash at either end. */
export function routeKey(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}
