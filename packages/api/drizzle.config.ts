import { defineConfig } from "drizzle-kit";
import { databasePath } from "@sapporta/server/data-dir";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./schema/**/*.ts", "./project-auth/schema.ts"],
  out: "./migrations",
  dbCredentials: {
    // The same database the app opens: sqlite.db in SAPPORTA_DATA_DIR.
    url: databasePath(),
  },
});
