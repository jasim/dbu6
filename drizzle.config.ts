import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// This repository holds no database. `db:generate` and `db:check` need none;
// `db:migrate` and `db:studio` open sqlite.db in SAPPORTA_DATA_DIR, which names
// a project's data directory, relative to this repository or absolute:
// `SAPPORTA_DATA_DIR=../demo-dbu6/data pnpm db:studio`.
const dataDir = process.env.SAPPORTA_DATA_DIR;

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/server/schema/**/*.ts",
    "./src/server/project-auth/schema.ts",
  ],
  // The migrations ship in the package, at its root (`dbu6MigrationsDir()` in
  // runtime.ts), so an installed dbu6 finds them without this repository.
  out: "./migrations",
  ...(dataDir && { dbCredentials: { url: resolve(dataDir, "sqlite.db") } }),
});
