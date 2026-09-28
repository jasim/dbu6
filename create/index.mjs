#!/usr/bin/env node

// `npm init @dbu6 <directory>`. npm maps `@dbu6` to this package and runs its
// one command, which runs `dbu6 init` from @dbu6/app with the same arguments.
// @dbu6/app is this package's only dependency, pinned to the same version by
// scripts/pack.mjs, so `npm init @dbu6@1.2.3` makes a project on dbu6 1.2.3.
//
// @dbu6/app is found the way Node resolves a package, walking up the
// node_modules directories, rather than through its `exports`, which do not
// include its bin.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const bin = findApp(import.meta.dirname);
const { status, signal } = spawnSync(
  process.execPath,
  [bin, "init", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(signal ? 1 : (status ?? 1));

function findApp(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules/@dbu6/app/bin/dbu6.mjs");
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) {
      console.error(`create-dbu6: @dbu6/app is not installed beside ${start}.`);
      process.exit(1);
    }
  }
}
