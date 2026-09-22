#!/usr/bin/env node

// The `dbu6` command. It is thin: the commands are compiled TypeScript in
// dist/cli, and this file only gets them loaded.
//
// In dbu6's own repository there is one more step, because dist/ is a build
// product there: `dev` starts from a clean dist/ with the Node side compiled
// (stale compiled schema modules would otherwise be loaded), and any other
// command compiles it when it is missing. A linked Sapporta checkout also
// needs its resolution hook registered before anything imports Sapporta.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = path.resolve(import.meta.dirname, "..");
const entry = path.join(packageDir, "dist/cli/main.js");
const [command] = process.argv.slice(2);

if (existsSync(path.join(packageDir, "src/server"))) {
  const node = (script, ...args) =>
    execFileSync(process.execPath, [path.join(packageDir, script), ...args], {
      cwd: packageDir,
      stdio: "inherit",
    });
  if (command === "dev") node("scripts/clean-dist.mjs");
  if (!existsSync(entry)) node("scripts/build.mjs", "--node");

  const { dependencies } = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  if (dependencies["@sapporta/server"]?.startsWith("link:")) {
    await import("@sapporta/server/source-link-runtime");
  }
}

const { main } = await import(pathToFileURL(entry).href);
let exitCode;
try {
  exitCode = await main(process.argv.slice(2));
} catch (error) {
  // The message is written for the person; DBU6_DEBUG adds the stack.
  console.error(process.env.DBU6_DEBUG ? error : `dbu6: ${error.message ?? error}`);
  exitCode = 1;
}
// Not `process.exitCode`: `dev` may leave Vite listening when it returns.
process.exit(exitCode);
