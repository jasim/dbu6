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
import { resolve } from "node:path";
import {
  connectProject,
  loadSapportaProject,
  pendingMigrations,
  setProjectRoot,
  type ProjectDbConnection,
  type SapportaProject,
} from "@sapporta/server";
import { buildAbility } from "./authz/ability.js";
import { resolveRequestDataAuthority } from "./authz/request-data-authority.js";
import { sqliteDbuConfig, useDbuConfig } from "./dbu-config.js";
import { createSapportaMailer, type SapportaMailer } from "./mailer.js";
import {
  loadCategorizer as loadOurCategorizer,
  type LoadCategorizer,
} from "./modules/categorization/index.js";
import { databaseFile, dbu6MigrationsDir, projectRoot } from "./paths.js";
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

/**
 * Opens dbu6 on `root`. Throws when the database's migrations are not exactly
 * ours: this function never changes a schema.
 */
export async function openDbu6Runtime(
  options: OpenDbu6RuntimeOptions,
): Promise<Dbu6Runtime> {
  const { root } = options;
  setProjectRoot(root);
  // paths.ts answers from DBU6_ROOT while it is set, so a runtime on another
  // folder would read that folder's config, parsers and reports.
  if (projectRoot() !== resolve(root)) {
    throw new Error(
      `dbu6 was opened on ${root}, but DBU6_ROOT names ${projectRoot()}.`,
    );
  }
  const file = databaseFile(root);
  const conn = connectProject(file);
  try {
    const pending = pendingMigrations(conn.sqlite, dbu6MigrationsDir());
    if (pending.length > 0) {
      throw new Error(
        [
          `${file} has migrations this dbu6 has not applied:`,
          ...pending.map((migration) => `  ${migration.tag}`),
          "dbu6 does not serve a database whose migrations are not exactly its own. " +
            "Run `dbu6 migrate`, or `dbu6 start`, which migrates safely before serving.",
        ].join("\n"),
      );
    }

    // The tables are the compiled `schema/` beside this file, and the
    // migrations are the package's; neither is looked up under the project
    // root. Sapporta's guard still refuses a database that has a migration
    // this dbu6 does not have, or one whose file changed.
    const sapporta = await loadSapportaProject({
      name: "dbu6",
      slug: "dbu6",
      projectRoot: root,
      apiDistDir: import.meta.dirname,
      migrationsDir: dbu6MigrationsDir(),
      conn,
    });

    useDbuConfig(sqliteDbuConfig(conn.db));

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
  } catch (error) {
    conn.sqlite.close();
    throw error;
  }
}
