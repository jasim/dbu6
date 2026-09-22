import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { SINGLE_COPY } from "./plugin.js";

/**
 * npm hoists dbu6's dependencies to the project's node_modules, so the
 * project's files and dbu6's files resolve the same React. That stops being
 * true when the project's package.json names its own, different version of
 * one of them: npm then nests dbu6's copy under node_modules/dbu6, and the
 * page would load React twice (or the wrong one). Vite's dev optimizer cannot
 * be talked out of that, so refuse to start and name the package.
 */
export function assertSingleCopies(
  projectRoot: string,
  packageDir: string,
): void {
  const fromProject = createRequire(path.join(projectRoot, "package.json"));
  const fromPackage = createRequire(path.join(packageDir, "package.json"));
  const conflicts: string[] = [];
  for (const name of SINGLE_COPY) {
    const ours = packageJsonOf(fromPackage, name);
    const theirs = packageJsonOf(fromProject, name);
    if (ours && theirs && fs.realpathSync(ours) !== fs.realpathSync(theirs)) {
      conflicts.push(
        `${name}: the project resolves ${theirs}, dbu6 resolves ${ours}`,
      );
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      "These packages must exist once, in the version dbu6 ships. Remove them " +
        "from the project's package.json and reinstall:\n  " +
        conflicts.join("\n  "),
    );
  }
}

function packageJsonOf(require: NodeJS.Require, name: string): string | null {
  // Not require.resolve(name + "/package.json"): `exports` may hide it.
  for (const dir of require.resolve.paths(name) ?? []) {
    const candidate = path.join(dir, name, "package.json");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
