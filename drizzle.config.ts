import { defineConfig } from "drizzle-kit";
import { databasePath } from "@sapporta/server/data-dir";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/server/schema/**/*.ts",
    "./src/server/project-auth/schema.ts",
  ],
  // The migrations ship in the package, at its root (`dbu6MigrationsDir()` in
  // runtime.ts), so an installed dbu6 finds them without this repository.
  out: "./migrations",
  dbCredentials: {
    // The same database the app opens: sqlite.db in SAPPORTA_DATA_DIR.
    url: databasePath(),
  },
});
