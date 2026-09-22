#!/usr/bin/env node

// The `dbu6` command. It is thin: the commands are compiled TypeScript in
// dist/cli, and this file only gets them loaded.
//
// Run from dbu6's own repository, as a project whose node_modules/dbu6 links
// to it does, there is one more step, because dist/ is a build product there:
// the Node side is compiled when it is missing. `pnpm dev` in the repository
// keeps it current. A linked Sapporta checkout also needs its resolution hook
// registered before anything imports Sapporta.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageDir = path.resolve(import.meta.dirname, "..");
const entry = path.join(packageDir, "dist/cli/main.js");

if (existsSync(path.join(packageDir, "src/server"))) {
  const node = (script, ...args) =>
    execFileSync(process.execPath, [path.join(packageDir, script), ...args], {
      cwd: packageDir,
      stdio: "inherit",
    });
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
