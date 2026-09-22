/**
 * dbu6 opened on a project folder, without any HTTP server around it.
 *
 * Opening the database, loading our tables, checking our migrations, and
 * building auth and mail are the same steps whether the process is about to
 * serve requests or a script is about to write rows. `open.ts` opens the
 * runtime and mounts Hono on it (`mount.ts`); `dbu6 seed` (`seed/sample-data.ts`)
 * opens it and writes to its connection.
 *
 * Two directories are involved (see `paths.ts`). What is the user's comes from
 * `root`. What is ours, the compiled tables and the migrations, comes from the
 * package, so a project that holds no code of ours still opens.
 */
import { join } from "node:path";
import {
  connectProject,
  databasePath,
  loadSapportaProject,
  setProjectRoot,
  type ProjectDbConnection,
  type SapportaProject,
} from "@sapporta/server";
import { buildAbility } from "./authz/ability.js";
import { resolveRequestDataAuthority } from "./authz/request-data-authority.js";
import { createSapportaMailer, type SapportaMailer } from "./mailer.js";
import {
  loadCategorizer as loadOurCategorizer,
  type LoadCategorizer,
} from "./modules/categorization/index.js";
import { dataDir, packageDir } from "./paths.js";
import {
  createProjectAuth,
  readProjectAuthEnv,
  type ProjectAuth,
  type ProjectAuthEnv,
  type PublicRoutePattern,
} from "./project-auth/index.js";

export interface OpenDbu6RuntimeOptions {
  /** The project folder: the user's config, parsers, reports and data. */
  root: string;
  /**
   * Routes an anonymous caller may reach. Only the HTTP server has anonymous
   * callers, and dbu6 has no public route of its own, so this is empty unless
   * the caller names one.
   *
   * PUBLIC ROUTE WARNING: a handler listed here must still read
   * `c.get("auth")`, call `forbidUnless(c, auth.ability.can(...))`, and use
   * row security for any table-backed data.
   */
  publicRoutes?: readonly PublicRoutePattern[];
  /**
   * Whether outgoing mail is delivered. Defaults to true, which honours
   * `SAPPORTA_MAIL_TRANSPORT`. A script turns it off, because the addresses in
   * a database belong to people who did not ask a script to write to them.
   */
  sendMail?: boolean;
  /**
   * The categorizer seam. Reclassification, the statement import and the
   * freeform import all categorize through it, which no single route
   * replacement would reach. Defaults to ours, which reads `user-config/`.
   */
  loadCategorizer?: LoadCategorizer;
}

export interface Dbu6Runtime {
  root: string;
  /** The SQLite file that `conn` opened. */
  databasePath: string;
  conn: ProjectDbConnection;
  sapporta: SapportaProject;
  env: ProjectAuthEnv;
  mailer: SapportaMailer;
  projectAuth: ProjectAuth;
  loadCategorizer: LoadCategorizer;
  /** Closes the database. The HTTP server holds it open for its lifetime. */
  close: () => void;
}

/** Our Drizzle migrations, which ship in the package. */
export function dbu6MigrationsDir(): string {
  return packageDir("migrations");
}

/**
 * `sqlite.db` in the project's `data/`. SAPPORTA_DATA_DIR still names another
 * directory when it is set, because Drizzle Kit and `pnpm setup` read it and
 * every tool in this repository must open the same database.
 */
export function databaseFile(root: string): string {
  return process.env.SAPPORTA_DATA_DIR
    ? databasePath()
    : join(dataDir(root), "sqlite.db");
}

/**
 * Opens dbu6 on `root`. Throws when the database's migrations are not exactly
 * ours: this function never changes a schema.
 */
export async function openDbu6Runtime(
  options: OpenDbu6RuntimeOptions,
): Promise<Dbu6Runtime> {
  const { root } = options;
  setProjectRoot(root);
  const file = databaseFile(root);
  const conn = connectProject(file);

  // The tables are the compiled `schema/` beside this file, and the migrations
  // are the package's; neither is looked up under the project root.
  const sapporta = await loadSapportaProject({
    name: "dbu6",
    slug: "dbu6",
    projectRoot: root,
    apiDistDir: import.meta.dirname,
    migrationsDir: dbu6MigrationsDir(),
    conn,
  });

  const env = readProjectAuthEnv();
  const mailer = createSapportaMailer(
    options.sendMail === false
      ? { from: env.mail.from, transport: "disabled" }
      : env.mail,
  );
  // Auth needs the loaded table catalog so every request can apply row
  // security before a handler reads or writes table-backed data.
  const projectAuth = createProjectAuth({
    conn,
    env,
    catalog: sapporta.catalog,
    mailer,
    buildAbility,
    resolveRequestDataAuthority,
    publicRoutes: options.publicRoutes,
  });

  return {
    root,
    databasePath: file,
    conn,
    sapporta,
    env,
    mailer,
    projectAuth,
    loadCategorizer: options.loadCategorizer ?? loadOurCategorizer,
    close: () => conn.sqlite.close(),
  };
}
