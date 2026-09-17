#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Everything a fresh clone needs between `pnpm install` and a working app:
// the development environment file, an auth secret, the private data
// directory, and the database schema.
//
// `pnpm dev` runs this through `predev`, so it also runs on every later start.
// Each step is therefore idempotent and never overwrites a file the developer
// has edited: re-running only fills in what is missing.
//
// Unlike the other scripts, this one takes no `--env-file`, because
// `.env.development` is one of the things it creates. It loads that file
// itself, once it exists.
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(projectRoot, ".env.development");

await createEnvFile();
await fillAuthSecret();
// Values already in the environment win over the file, so a mise.toml or a
// shell export still overrides anything set here.
process.loadEnvFile(envPath);
await seedUserConfig();
migrateDatabase();

/** Copy the tracked example to `.env.development` unless the developer has one. */
async function createEnvFile() {
  try {
    // COPYFILE_EXCL: fail instead of clobbering a file that already exists.
    await copyFile(
      join(projectRoot, ".env.development.example"),
      envPath,
      constants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (error.code === "EEXIST") return;
    throw error;
  }
  console.log("Created .env.development from .env.development.example.");
}

/**
 * Give the blank `BETTER_AUTH_SECRET=` a value. Better Auth signs session
 * cookies with it and refuses to start without one. Generating it here is safe
 * because `.env.development` is gitignored and local to this machine; changing
 * it later only signs out the developer's own dev sessions.
 */
async function fillAuthSecret() {
  const contents = await readFile(envPath, "utf8");
  const blank = /^BETTER_AUTH_SECRET=[ \t]*$/m;
  if (!blank.test(contents)) return;

  const secret = randomBytes(32).toString("base64");
  await writeFile(envPath, contents.replace(blank, `BETTER_AUTH_SECRET=${secret}`));
  console.log("Generated BETTER_AUTH_SECRET in .env.development.");
}

/**
 * Seed the private data directory from the tracked example config. Everything
 * personal — the SQLite database and the user's own mappings, prompts, and
 * presets — lives in SAPPORTA_DATA_DIR (data/ by default, gitignored as a unit).
 */
async function seedUserConfig() {
  const exampleDir = join(projectRoot, "user-config.example");
  const targetDir = join(dataDir(), "user-config");
  await mkdir(targetDir, { recursive: true });

  const entries = await readdir(exampleDir, { withFileTypes: true });
  const copied = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      await copyFile(
        join(exampleDir, entry.name),
        join(targetDir, entry.name),
        constants.COPYFILE_EXCL,
      );
      copied.push(entry.name);
    } catch (error) {
      if (error.code === "EEXIST") continue;
      throw error;
    }
  }

  if (copied.length > 0) {
    console.log(`Seeded ${targetDir} from user-config.example/:`);
    for (const name of copied) console.log(`  ${name}`);
    console.log("\nEdit these to match your own accounts before importing.");
  }
}

/**
 * Bring the database up to the latest schema. The repository ships no database
 * — `data/` is gitignored — so on a fresh clone this is what creates it, by
 * replaying every migration in `packages/api/migrations/` onto an empty file.
 * On later runs Drizzle Kit applies only what is pending, and says nothing when
 * there is none.
 *
 * Drizzle Kit runs from `packages/api`, where its config lives, and inherits
 * the environment loaded above so it opens the same database as the app.
 */
function migrateDatabase() {
  const apiDir = join(projectRoot, "packages", "api");
  const { status, error } = spawnSync(
    process.execPath,
    [join(apiDir, "node_modules", "drizzle-kit", "bin.cjs"), "migrate"],
    { cwd: apiDir, stdio: "inherit" },
  );

  if (error) throw error;
  if (status !== 0) {
    console.error("\nMigrating the database failed; see the output above.");
    process.exit(status ?? 1);
  }
}

/**
 * Same rule as dataPath() in @sapporta/server: required, and a relative path is
 * resolved against the project root rather than the working directory.
 */
function dataDir() {
  const configured = process.env.SAPPORTA_DATA_DIR;
  if (!configured) {
    console.error(
      "SAPPORTA_DATA_DIR is not set. Set it in .env.development to the directory that holds this app's sqlite.db.",
    );
    process.exit(1);
  }
  return isAbsolute(configured) ? configured : resolve(projectRoot, configured);
}
