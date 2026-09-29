#!/usr/bin/env node

// Pins dbu6 to exact npm versions of the packages it consumes, for the
// release train in ../sapporta-devtools. The train releases Sapporta and
// nuabase before dbu6; once their new versions are on npm, it calls
//
//   pnpm release:pin @sapporta/server@0.9.1 nuabase@2.4.0 ...
//
// so that the dbu6 it then releases is built and tested against exactly those
// versions. The steps, in order, stopping at the first that fails:
//
//   1. package-source-switch.mjs update-npm <name@version ...>: record the
//      versions given, keeping the others already recorded
//   2. package-source-switch.mjs use:npm: write the recorded versions into
//      package.json and remove any `link:` overrides
//   3. pnpm install: resolve them and update pnpm-lock.yaml
//   4. package-source-switch.mjs verify: package.json, the workspace file and
//      the lockfile all name npm versions
//
// Nothing is committed: the train commits package.json and pnpm-lock.yaml
// together with the version the changesets produce. dbu6 then stays on these
// npm versions until someone links the checkouts again with `pnpm
// release:link`.
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pins = process.argv.slice(2);
if (pins.length === 0) {
  console.error(
    "Usage: pnpm release:pin <name@version> [...]\n" +
      "Names each consumed package's version to pin, such as @sapporta/server@0.9.1.",
  );
  process.exit(1);
}

const switcher = path.join("scripts", "package-source-switch.mjs");
const steps = [
  [process.execPath, [switcher, "update-npm", ...pins]],
  [process.execPath, [switcher, "use:npm"]],
  ["pnpm", ["install"]],
  [process.execPath, [switcher, "verify"]],
];

for (const [command, args] of steps) {
  const label = `${command === process.execPath ? "node" : command} ${args.join(" ")}`;
  console.log(`\n> ${label}`);
  const { status, error } = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (error || status !== 0) {
    console.error(
      `\nrelease:pin stopped at \`${label}\`: ${error ? error.message : `exited with ${status}`}.`,
    );
    process.exit(1);
  }
}
console.log(`\nPinned ${pins.join(", ")}. Nothing is committed.`);
