/**
 * App-specific API routes.
 *
 * Mount each `packages/api/app/*.ts` sub-app here. `app` is already scoped to
 * `/api`, so `app.route("/bank", bankApi)` is served at `/api/bank`; do not
 * repeat the `/api` prefix.
 *
 * Add a route here when you want it available from the browser, CLI, or API
 * clients. New files under `packages/api/app/` are not exposed until you mount
 * them here.
 */
import type {
  ProjectDbConnection,
  SapportaEnv,
  TsRestApi,
} from "@sapporta/server";
import classifyDraftTransactionsApi from "./app/classify-draft-transactions.js";
import importDraftAbacusApi from "./app/import-draft-abacus.js";
import importDraftStatementsAutoApi from "./app/import-draft-statements-auto.js";
import importPresetsApi from "./app/import-presets.js";
import postDraftsToJournalApi from "./app/post-drafts-to-journal.js";
import renderDraftHledgerApi from "./app/render-draft-hledger.js";
import renderJournalsHledgerApi from "./app/render-journals-hledger.js";
import reportsApi from "./app/reports.js";
import type { SapportaMailer } from "./mailer.js";
import type { PublicRoutePattern } from "./project-auth/index.js";

export interface LoadAppOptions {
  conn: ProjectDbConnection;
  mailer: SapportaMailer;
}

function mountApi(app: TsRestApi<SapportaEnv>, api: TsRestApi<SapportaEnv>) {
  app.route("/", api);
  // app.route mounts runtime handlers; extend carries sub-app contracts into OpenAPI.
  app.extend(api as unknown as { docEmitters: readonly never[] });
}

export function loadApp(app: TsRestApi<SapportaEnv>, _options: LoadAppOptions) {
  mountApi(app, reportsApi);
  mountApi(app, importPresetsApi);
  mountApi(app, importDraftStatementsAutoApi);
  mountApi(app, importDraftAbacusApi);
  mountApi(app, classifyDraftTransactionsApi);
  mountApi(app, renderDraftHledgerApi);
  mountApi(app, renderJournalsHledgerApi);
  mountApi(app, postDraftsToJournalApi);
}

export const publicApiRoutes =
  [] as const satisfies readonly PublicRoutePattern[];

/**
 * PUBLIC ROUTE WARNING
 *
 * Routes in `publicApiRoutes` can be reached by anonymous visitors. Add a path
 * here only when the feature is intentionally public. The handler must still
 * read `c.get("auth")`, call `forbidUnless(c, auth.ability.can(...))`, and use
 * row security for any table-backed data.
 *
 * For table-backed public pages, import the table definition and compose the
 * route predicate with row security:
 *
 *   const auth = c.get("auth");
 *   forbidUnless(c, auth.ability.can("read-published", "quotes"));
 *   const access = auth.rowSecurity.forTable(quotes);
 *   const where = access.ownedRows(eq(quotesTable.published, true));
 */
