#!/usr/bin/env node

import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Seed the private data directory from the tracked example config. Everything
// personal — the SQLite database and the user's own mappings, prompts, and
// presets — lives in SAPPORTA_DATA_DIR (data/ by default, gitignored as a unit).
//
// Existing files are never overwritten, so this is safe to run on every dev
// start and safe to re-run after adding a new example file.
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const exampleDir = join(projectRoot, "user-config.example");
// Same rule as dataPath() in @sapporta/server: required, and a relative path is
// resolved against the project root rather than the working directory.
const configuredDataDir = process.env.SAPPORTA_DATA_DIR;
if (!configuredDataDir) {
  console.error(
    "SAPPORTA_DATA_DIR is not set. Set it in .env.development to the directory that holds this app's sqlite.db.",
  );
  process.exit(1);
}
const dataDir = isAbsolute(configuredDataDir)
  ? configuredDataDir
  : resolve(projectRoot, configuredDataDir);
const targetDir = join(dataDir, "user-config");

await mkdir(targetDir, { recursive: true });

const entries = await readdir(exampleDir, { withFileTypes: true });
const copied = [];

for (const entry of entries) {
  if (!entry.isFile()) continue;
  try {
    // COPYFILE_EXCL: fail instead of clobbering a file the user has edited.
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
