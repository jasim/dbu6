// Whether a version of dbu6 is on npm. Two scripts ask: scripts/release.mjs,
// which resumes a release that stopped halfway by publishing only what is
// missing, and scripts/release-status.mjs, which tells the release train
// whether this version still has to be released.
//
// A version of dbu6 is two packages, @dbu6/app and @dbu6/create, released
// together at the same version (scripts/pack.mjs gives create the app's
// version). The version counts as released only when both are on npm; after
// a release that stopped between the two, the app is there and create is not.
import { spawnSync } from "node:child_process";

/** The packages one dbu6 version consists of, in the order they are published. */
export const RELEASED_PACKAGES = ["@dbu6/app", "@dbu6/create"];

/**
 * Whether `name@version` is on the registry. A 404 means it is not; any other
 * failure (no network, a registry error) throws, because guessing either way
 * would make a release skip a publish or repeat one.
 *
 * `npm` is spawned as the binary, never through a shell: the owner's shell
 * defines a function of that name that refuses to run, and spawnSync with a
 * command and an argument list runs no shell.
 */
export function isPublished(name, version) {
  const result = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "version", "--json"],
    {
      encoding: "utf8",
    },
  );
  if (result.error) {
    throw new Error(`npm view ${name}@${version}: ${result.error.message}`);
  }
  const output = result.stdout.trim();
  if (result.status === 0) {
    // An older npm answers a missing version of an existing package with
    // nothing at all and exit 0, so the version printed is what counts.
    return output !== "" && JSON.parse(output) === version;
  }
  // With --json the error is a JSON object on stdout: `{ "error": { "code" } }`.
  let code;
  try {
    code = JSON.parse(output)?.error?.code;
  } catch {
    code = undefined;
  }
  if (code === "E404") return false;
  throw new Error(
    `npm view ${name}@${version} failed (exit ${result.status}):\n${result.stderr.trim()}`,
  );
}

/** Which of the version's packages are on npm, as `{ name, published }`. */
export function publishedPackages(version) {
  return RELEASED_PACKAGES.map((name) => ({
    name,
    published: isPublished(name, version),
  }));
}
