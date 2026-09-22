#!/usr/bin/env node

// `pnpm dev`: keeps dist/ compiled while dbu6 is worked on. It serves nothing,
// because this repository is not a project: a project folder whose
// node_modules/dbu6 links to this checkout, such as ../demo-dbu6, runs
// `dbu6 dev`, and its server restarts when the compiled files change.
//
// It starts from a clean dist/, because stale compiled schema modules would
// otherwise be loaded, compiles the Node side once, and then runs two
// TypeScript watchers: one recompiles the Node side into dist/, and one
// typechecks the frontend, which Vite does not.
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tsc = path.join(root, "node_modules/typescript/bin/tsc");

const node = (script, ...args) =>
  execFileSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    stdio: "inherit",
  });
node("scripts/clean-dist.mjs");
node("scripts/build.mjs", "--node");

const watch = ["--watch", "--preserveWatchOutput"];
const watchers = [
  ["Compile the Node side on change", [tsc, "-p", "tsconfig.json", ...watch]],
  [
    "Typecheck the frontend on change",
    [tsc, "-p", "src/frontend", "--noEmit", ...watch],
  ],
].map(([label, args]) => {
  console.log(`\n> ${label}`);
  return spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
});

const stop = (signal) => {
  for (const watcher of watchers) {
    if (watcher.exitCode === null && watcher.signalCode === null) {
      watcher.kill(signal);
    }
  }
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    stop(signal);
    process.exit(0);
  });
}
// A watcher that stops on its own takes `dev` down with it.
for (const watcher of watchers) {
  watcher.once("exit", (code) => {
    stop("SIGTERM");
    process.exit(code ?? 1);
  });
}
