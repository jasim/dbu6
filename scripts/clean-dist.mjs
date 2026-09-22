#!/usr/bin/env node

import { rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Clean the build output once at dev/build startup. TypeScript leaves stale
// files in outDir after source files are deleted, and stale compiled schema
// modules in dist/server/schema are loaded and mounted by Sapporta at boot.
// Restarting with a clean dist fixes those stale-runtime errors without making
// every incremental watch rebuild pay for a full clean.
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Refuse to delete anything unless this really is dbu6's root.
const manifest = await stat(join(projectRoot, "package.json")).catch(
  () => null,
);
const sources = await stat(join(projectRoot, "src", "server")).catch(
  () => null,
);
if (!manifest?.isFile() || !sources?.isDirectory()) {
  throw new Error(`Refusing to clean: ${projectRoot} is not the dbu6 root.`);
}

await rm(join(projectRoot, "dist"), { force: true, recursive: true });
await rm(join(projectRoot, "tsconfig.tsbuildinfo"), { force: true });
