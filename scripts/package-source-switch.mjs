#!/usr/bin/env node

// Switches every managed dependency between a local checkout and its npm
// release, so a branch can depend on framework changes that are not published
// yet and still be packed and published later.
//
//   pnpm package-sources status
//   pnpm package-sources update-npm [name@version ...]
//   pnpm package-sources use:npm
//   pnpm package-sources use:local [workspace] [--nuabase <path>]
//   pnpm package-sources verify
//
// "Local" writes `link:` specs into package.json and matching `pnpm.overrides`
// into pnpm-workspace.yaml, so the linked packages' own `workspace:*`
// dependencies resolve from the same checkouts. "npm" writes the versions
// recorded in the gitignored .package-source-switch.json and removes those
// overrides. Both are all-or-nothing: every managed package moves together,
// and `verify` refuses a tree that mixes the two.
//
// `update-npm` records the npm versions `use:npm` writes. Without arguments it
// records each managed package's `latest` on the registry. With `name@version`
// arguments it records exactly those versions and leaves the other recorded
// ones as they are; a managed package that is neither named nor recorded yet
// gets its `latest`. The release train in ../sapporta-devtools uses the second
// form (through `pnpm release:pin`, scripts/release-pin.mjs) to pin dbu6 to
// the versions it has just published, which `latest` may not be when a
// release is a prerelease or npm has not caught up.
import { existsSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const CONFIG_FILE = ".package-source-switch.json";
const WORKSPACE_FILE = "pnpm-workspace.yaml";
const DEPENDENCY_KEYS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

/**
 * Every dependency dbu6 links to a checkout. `root` names the checkout (see
 * ROOTS) and `path` is the package's directory inside it, because the two
 * checkouts keep their packages differently: Sapporta's under packages/,
 * nuabase's client under nua-llm/.
 *
 * Linked Sapporta packages run from their TypeScript sources, which needs
 * Sapporta's resolution hook; npm ones do not. No script is rewritten for it:
 * bin/dbu6.mjs registers the hook itself when @sapporta/server is a `link:`.
 */
const LINKED_PACKAGES = [
  { name: "@sapporta/server", root: "sapporta", path: "packages/core" },
  { name: "@sapporta/honest", root: "sapporta", path: "packages/honest" },
  { name: "@sapporta/shared", root: "sapporta", path: "packages/shared" },
  { name: "@sapporta/ui", root: "sapporta", path: "packages/ui" },
  { name: "@sapporta/grid", root: "sapporta", path: "packages/grid" },
  { name: "@sapporta/frontend", root: "sapporta", path: "packages/frontend" },
  { name: "nuabase", root: "nuabase", path: "nua-llm/nua-client" },
];
const PACKAGE_BY_NAME = new Map(
  LINKED_PACKAGES.map((entry) => [entry.name, entry]),
);

/**
 * The checkouts dbu6 links from. Each has an environment variable so a root
 * can be named without editing the gitignored config file;
 * `SAPPORTA_PACKAGE_ROOT` is the variable the Sapporta CLI already reads when
 * it scaffolds source-linked projects, so one setting drives both.
 */
const ROOTS = [
  { name: "sapporta", env: "SAPPORTA_PACKAGE_ROOT" },
  { name: "nuabase", env: "NUABASE_PACKAGE_ROOT" },
];
const ROOT_BY_NAME = new Map(ROOTS.map((root) => [root.name, root]));

// dbu6 is one package, so the root manifest is the only one that names any of
// them. template/package.json is not ours to rewrite: it is the user's
// starting manifest and pins dbu6 alone.
const MANIFEST_FILES = ["package.json"];

const rootDir = process.cwd();
// Assigned inside the try below so a mistyped option is reported like any
// other refusal instead of as a stack trace.
let options = {};
let command = "help";
let commandArgs = [];

try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      sapporta: { type: "string" },
      nuabase: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  options = parsed.values;
  command = parsed.positionals[0] ?? "help";
  commandArgs = parsed.positionals.slice(1);

  switch (command) {
    case "status":
      expectNoArguments();
      await showStatus();
      break;
    case "update-npm":
      await updateNpmVersions(parsePins(commandArgs));
      break;
    case "use:npm":
      expectNoArguments();
      await switchSources("npm", new Map());
      break;
    case "use:local":
      await switchSources("local", rootOverrides());
      break;
    case "verify":
      expectNoArguments();
      await verifyCurrentMode();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run with --help.`);
  }
} catch (error) {
  console.error(
    `package-sources: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

/** The checkouts named on a `use:local` command line, if any. */
function rootOverrides() {
  const overrides = new Map();
  if (commandArgs.length > 1) {
    throw new Error(
      `use:local takes at most one workspace path: ${commandArgs.join(" ")}`,
    );
  }
  if (commandArgs[0] && options.sapporta) {
    throw new Error(
      "Name the Sapporta checkout once: either the workspace path or --sapporta.",
    );
  }
  const sapporta = options.sapporta ?? commandArgs[0];
  if (sapporta) overrides.set("sapporta", sapporta);
  if (options.nuabase) overrides.set("nuabase", options.nuabase);
  return overrides;
}

function expectNoArguments() {
  if (commandArgs.length > 0) {
    throw new Error(`"${command}" takes no arguments: ${commandArgs.join(" ")}`);
  }
}

async function showStatus() {
  const config = await readConfigIfPresent();
  const manifests = await readManifestFiles();
  const locations = findLinkedLocations(manifests);
  const workspaceOverrides = await readWorkspaceOverrides();
  const counts = { local: 0, npm: 0, other: 0 };

  for (const location of locations) {
    counts[classifySource(location.spec)] += 1;
  }

  console.log(`Config: ${CONFIG_FILE} ${config ? "present" : "missing"}`);
  console.log(`Configured mode: ${config?.mode ?? "unknown"}`);
  for (const line of describeRoots(config)) console.log(`Checkout ${line}`);
  console.log(
    `Direct entries: ${locations.length} of ${LINKED_PACKAGES.length} managed ` +
      `packages (local ${counts.local}, npm ${counts.npm}, other ${counts.other})`,
  );

  const overrideCounts = { local: 0, npm: 0, other: 0, missing: 0 };
  for (const { name } of LINKED_PACKAGES) {
    const value = workspaceOverrides.get(name);
    if (value === undefined) overrideCounts.missing += 1;
    else overrideCounts[classifySource(value)] += 1;
  }
  console.log(
    `Workspace overrides: local ${overrideCounts.local}, ` +
      `npm ${overrideCounts.npm}, other ${overrideCounts.other}, ` +
      `missing ${overrideCounts.missing}`,
  );

  // Per package, because the summary above cannot say which one disagrees.
  for (const { name } of LINKED_PACKAGES) {
    const location = locations.find((item) => item.packageName === name);
    const override = workspaceOverrides.get(name);
    const source = location
      ? `${location.spec}${override === undefined ? "" : `  [override: ${override}]`}`
      : "(not in package.json)";
    console.log(`  ${name.padEnd(22)} ${source}`);
  }
}

/**
 * The `name@version` arguments of `update-npm`, as a map. Each name must be a
 * managed package and each version exact, since it is written into
 * package.json as it is.
 */
function parsePins(args) {
  const pins = new Map();
  for (const arg of args) {
    // The last `@`, so that a scoped name keeps its own.
    const at = arg.lastIndexOf("@");
    const name = at > 0 ? arg.slice(0, at) : "";
    const version = at > 0 ? arg.slice(at + 1) : "";
    if (!name || !version) {
      throw new Error(`Expected name@version, got "${arg}".`);
    }
    if (!PACKAGE_BY_NAME.has(name)) {
      throw new Error(
        `${name} is not a managed package. Managed: ` +
          `${LINKED_PACKAGES.map((entry) => entry.name).join(", ")}.`,
      );
    }
    if (classifySource(version) !== "npm") {
      throw new Error(`${arg}: "${version}" is not an exact version.`);
    }
    if (pins.has(name) && pins.get(name) !== version) {
      throw new Error(
        `${name} is named twice, at ${pins.get(name)} and ${version}.`,
      );
    }
    pins.set(name, version);
  }
  return pins;
}

async function updateNpmVersions(pins) {
  const config = await readConfig();
  const manifests = await readManifestFiles();
  const packageNames = new Set([
    ...findLinkedLocations(manifests).map((location) => location.packageName),
    ...Object.keys(config.npm),
    ...pins.keys(),
  ]);

  if (packageNames.size === 0) {
    throw new Error("No linked package dependencies were found.");
  }

  for (const packageName of [...packageNames].sort()) {
    let version;
    let from;
    if (pins.has(packageName)) {
      version = pins.get(packageName);
      from = "as given";
    } else if (pins.size > 0 && config.npm[packageName]) {
      version = config.npm[packageName];
      from = "kept";
    } else {
      version = await fetchLatestVersion(packageName);
      from = "latest";
    }
    config.npm[packageName] = version;
    console.log(`${packageName}: ${version} (${from})`);
  }

  config.updatedAt = new Date().toISOString();
  await writeConfig(config);
  console.log(`Wrote ${CONFIG_FILE}`);
}

async function switchSources(target, requestedRoots) {
  const config = await readConfig();
  for (const [name, value] of requestedRoots) {
    if (!ROOT_BY_NAME.has(name)) {
      throw new Error(`Unknown checkout "${name}".`);
    }
    config.roots[name] = path.resolve(rootDir, value);
  }

  const manifests = await readManifestFiles();
  const locations = findLinkedLocations(manifests);
  if (locations.length === 0) {
    throw new Error("No linked package dependencies were found.");
  }

  const sourceByPackage =
    target === "local"
      ? await localSources(config, manifests)
      : npmSources(config, locations);

  const changedFiles = new Set();
  for (const location of locations) {
    const manifest = manifests.find((item) => item.file === location.file);
    if (!manifest) {
      throw new Error(`Stored manifest no longer exists: ${location.file}`);
    }
    const value = sourceByPackage.get(location.packageName);
    if (!value) {
      throw new Error(`No ${target} source for ${location.packageName}.`);
    }
    setPath(manifest.json, location.path, value);
    changedFiles.add(location.file);
  }

  const migratedOverrides = migrateRootPnpmOverrides(manifests, changedFiles);

  for (const manifest of manifests) {
    if (!changedFiles.has(manifest.file)) continue;
    await writeJsonFile(path.join(rootDir, manifest.file), manifest.json);
  }

  await updateWorkspaceOverrides({
    migratedOverrides,
    linkedSources: target === "local" ? sourceByPackage : new Map(),
  });

  config.mode = target;
  config.updatedAt = new Date().toISOString();
  await writeConfig(config);
  await verifyManifestState(target, config);

  console.log(
    `Switched ${changedFiles.size} package.json file(s) to ${target}.`,
  );
  console.log(`Run "pnpm install" and then "pnpm package-sources:verify".`);
}

async function verifyCurrentMode() {
  const config = await readConfig();
  await verifyManifestState(config.mode, config);
  await verifyLockfile(config.mode);
  console.log(`Verified the ${config.mode} dependency graph.`);
}

async function verifyManifestState(mode, config) {
  if (mode !== "local" && mode !== "npm") {
    throw new Error(`Unknown configured mode "${mode}".`);
  }

  const manifests = await readManifestFiles();
  const locations = findLinkedLocations(manifests);
  const expectedSources =
    mode === "local"
      ? await localSources(config, manifests)
      : npmSources(config, locations);
  const errors = [];

  for (const location of locations) {
    const manifest = manifests.find((item) => item.file === location.file);
    const actual = getPath(manifest?.json, location.path);
    const expected = expectedSources.get(location.packageName);
    if (actual !== expected) {
      errors.push(
        `${location.file}:${location.path.join(".")} is ${JSON.stringify(actual)}; ` +
          `expected ${JSON.stringify(expected)}`,
      );
    }
  }

  // Every managed package, not just the declared ones, so a link override
  // left over from a checkout that is no longer a dependency still fails.
  const workspaceOverrides = await readWorkspaceOverrides();
  for (const { name } of LINKED_PACKAGES) {
    const actual = workspaceOverrides.get(name);
    const expected = expectedSources.get(name);
    if (mode === "npm") {
      if (actual !== undefined) {
        errors.push(`${WORKSPACE_FILE} still overrides ${name} in npm mode`);
      }
    } else if (expected === undefined) {
      if (actual !== undefined) {
        errors.push(
          `${WORKSPACE_FILE} overrides ${name}, which package.json does not declare`,
        );
      }
    } else if (actual !== expected) {
      errors.push(
        `${WORKSPACE_FILE} override ${name} is ${JSON.stringify(actual)}; ` +
          `expected ${JSON.stringify(expected)}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `${mode} source verification failed:\n- ${errors.join("\n- ")}`,
    );
  }
}

async function verifyLockfile(mode) {
  const lockfilePath = path.join(rootDir, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    throw new Error("pnpm-lock.yaml is missing. Run pnpm install first.");
  }
  const lockfile = await readFile(lockfilePath, "utf8");

  if (mode === "local") {
    // A package entry at the top level of the lockfile, `name@version`, is the
    // registry's; `name@link:` is the checkout's.
    const registryEntries = LINKED_PACKAGES.flatMap(({ name }) =>
      lockfile.match(
        new RegExp(`^ {2}'?${escapeRegExp(name)}@(?!link:)`, "gm"),
      ) ?? [],
    );
    const packedEntries = LINKED_PACKAGES.flatMap(({ name }) =>
      lockfile.match(
        new RegExp(
          `file:[^\\n]*${escapeRegExp(tarballStem(name))}[^\\n]*\\.tgz`,
          "gi",
        ),
      ) ?? [],
    );
    if (registryEntries.length > 0 || packedEntries.length > 0) {
      throw new Error(
        [
          "Local mode lockfile contains non-linked managed packages.",
          ...registryEntries,
          ...packedEntries,
        ].join("\n"),
      );
    }
  } else {
    // A link is named either by the package it belongs to, in an override or a
    // specifier, or only by the directory it points into when pnpm rewrites an
    // absolute link relative to the importer.
    const links = lockfile
      .split("\n")
      .filter((line) => line.includes("link:"))
      .filter((line) =>
        LINKED_PACKAGES.some(
          ({ name, path: subpath }) =>
            line.includes(name) || line.includes(subpath),
        ),
      );
    if (links.length > 0) {
      throw new Error(
        ["npm mode lockfile still contains links to a checkout.", ...links].join(
          "\n",
        ),
      );
    }
  }
}

/** How npm names a package's tarball: `@scope/name` becomes `scope-name`. */
function tarballStem(packageName) {
  return packageName.replace(/^@/, "").replace("/", "-");
}

async function localSources(config, manifests) {
  const specs = new Map(
    findLinkedLocations(manifests).map((location) => [
      location.packageName,
      location.spec,
    ]),
  );
  const sources = new Map();

  for (const { name, root, path: packagePath } of LINKED_PACKAGES) {
    // Only what package.json declares: a managed package someone removed must
    // not drag its checkout back in.
    if (!specs.has(name)) continue;

    // A root that is not configured yet can be read off the link already in
    // the manifest, so a checkout that was linked before the roots became two
    // keeps working, and `use:local` needs no paths to stay where it is.
    const configured = config.roots[root] ?? rootFromLink(specs.get(name), name);
    if (!configured) {
      throw new Error(
        `No ${root} checkout is configured for ${name}. Set ` +
          `${ROOT_BY_NAME.get(root).env}, or run "pnpm package-sources ` +
          `use:local ${exampleUseLocal(root)}".`,
      );
    }

    const canonicalRoot = await canonicalCheckout(configured, root);
    const packageRoot = path.join(canonicalRoot, packagePath);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error(`Missing ${packageJsonPath}`);
    }
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (packageJson.name !== name) {
      throw new Error(
        `${packageJsonPath} is ${JSON.stringify(packageJson.name)}, ` +
          `expected ${JSON.stringify(name)}`,
      );
    }
    config.roots[root] = canonicalRoot;
    sources.set(name, `link:${packageRoot}`);
  }

  return sources;
}

function exampleUseLocal(root) {
  return root === "sapporta"
    ? "/absolute/path/to/sapporta"
    : `--${root} /absolute/path/to/${root}`;
}

async function canonicalCheckout(directory, rootName) {
  const canonical = await realpath(directory).catch(() => undefined);
  if (!canonical) {
    throw new Error(`The ${rootName} checkout does not exist: ${directory}`);
  }
  return canonical;
}

/** The checkout a `link:` spec points into, or undefined when it is not one. */
function rootFromLink(spec, packageName) {
  const linked = PACKAGE_BY_NAME.get(packageName);
  if (!linked || typeof spec !== "string" || !spec.startsWith("link:")) {
    return undefined;
  }
  const packageRoot = path.resolve(rootDir, spec.slice("link:".length));
  const suffix = path.join(path.sep, linked.path);
  return packageRoot.endsWith(suffix)
    ? packageRoot.slice(0, -suffix.length)
    : undefined;
}

function npmSources(config, locations) {
  const sources = new Map();
  for (const { packageName } of locations) {
    const version = config.npm[packageName];
    if (!version) {
      throw new Error(
        `Missing npm version for ${packageName}. Run ` +
          `"pnpm package-sources:update-npm" first.`,
      );
    }
    sources.set(packageName, version);
  }
  return sources;
}

function migrateRootPnpmOverrides(manifests, changedFiles) {
  const rootManifest = manifests.find(
    (manifest) => manifest.file === "package.json",
  );
  const overrides = rootManifest?.json.pnpm?.overrides;
  if (!rootManifest || !isRecord(overrides)) return new Map();

  delete rootManifest.json.pnpm.overrides;
  if (Object.keys(rootManifest.json.pnpm).length === 0) {
    delete rootManifest.json.pnpm;
  }
  changedFiles.add(rootManifest.file);
  return new Map(Object.entries(overrides));
}

async function readManifestFiles() {
  const files = [];
  for (const file of MANIFEST_FILES) {
    const json = JSON.parse(await readFile(path.join(rootDir, file), "utf8"));
    files.push({ file, json });
  }
  return files;
}

function findLinkedLocations(manifests) {
  const locations = [];
  for (const manifest of manifests) {
    collectLinkedLocations(manifest.json, [], manifest.file, locations);
  }
  return locations.sort((a, b) =>
    `${a.file}:${a.path.join(".")}`.localeCompare(
      `${b.file}:${b.path.join(".")}`,
    ),
  );
}

function collectLinkedLocations(value, segments, file, locations) {
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const parentKey = segments.at(-1);
    if (
      typeof child === "string" &&
      DEPENDENCY_KEYS.has(parentKey) &&
      PACKAGE_BY_NAME.has(key)
    ) {
      locations.push({
        file,
        path: [...segments, key],
        packageName: key,
        spec: child,
      });
      continue;
    }
    collectLinkedLocations(child, [...segments, key], file, locations);
  }
}

async function readWorkspaceOverrides() {
  const workspacePath = path.join(rootDir, WORKSPACE_FILE);
  const source = await readFile(workspacePath, "utf8");
  return parseTopLevelStringMap(source, "overrides").values;
}

async function updateWorkspaceOverrides({ migratedOverrides, linkedSources }) {
  const workspacePath = path.join(rootDir, WORKSPACE_FILE);
  const source = await readFile(workspacePath, "utf8");
  const parsed = parseTopLevelStringMap(source, "overrides");
  const values = new Map(parsed.values);

  for (const [key, value] of migratedOverrides) {
    if (!values.has(key)) values.set(key, String(value));
  }
  // Every managed package, so a link override never survives a switch to npm.
  for (const { name } of LINKED_PACKAGES) {
    values.delete(name);
  }
  for (const [packageName, spec] of linkedSources) {
    values.set(packageName, spec);
  }

  const block = [
    "overrides:",
    ...[...values].map(
      ([key, value]) => `  ${yamlString(key)}: ${yamlString(value)}`,
    ),
  ];
  const lines = source.replace(/\n$/, "").split("\n");
  lines.splice(parsed.start, parsed.end - parsed.start, ...block);
  await writeFile(workspacePath, `${lines.join("\n")}\n`);
}

function parseTopLevelStringMap(source, key) {
  const lines = source.replace(/\n$/, "").split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) {
    return { start: lines.length, end: lines.length, values: new Map() };
  }

  let end = start + 1;
  const values = new Map();
  while (end < lines.length) {
    const line = lines[end];
    if (line !== "" && !line.startsWith(" ") && !line.startsWith("#")) break;
    if (line.startsWith("  ") && !line.trimStart().startsWith("#")) {
      const match = line.match(/^  ("(?:[^"\\]|\\.)*"|'[^']*'|[^:]+):\s*(.+)$/);
      if (!match) {
        throw new Error(
          `Cannot safely update ${key} in ${WORKSPACE_FILE}: ${line}`,
        );
      }
      values.set(parseYamlString(match[1].trim()), parseYamlString(match[2]));
    }
    end += 1;
  }
  while (end > start + 1 && lines[end - 1] === "") end -= 1;
  return { start, end, values };
}

function parseYamlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) return JSON.parse(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

async function fetchLatestVersion(packageName) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${packageName} from npm registry: ` +
        `${response.status} ${response.statusText}`,
    );
  }
  const body = await response.json();
  const latest = body?.["dist-tags"]?.latest;
  if (!latest) {
    throw new Error(
      `npm registry response for ${packageName} had no latest tag.`,
    );
  }
  return latest;
}

async function readConfigIfPresent() {
  const file = path.join(rootDir, CONFIG_FILE);
  if (!existsSync(file)) return undefined;
  return normalizeConfig(JSON.parse(await readFile(file, "utf8")));
}

async function readConfig() {
  const config = (await readConfigIfPresent()) ?? emptyConfig();
  for (const { name, env } of ROOTS) {
    const fromEnv = envRoot(env);
    if (fromEnv) config.roots[name] = fromEnv;
  }
  return config;
}

function emptyConfig() {
  return { version: 3, mode: "npm", roots: {}, npm: {}, updatedAt: null };
}

function envRoot(env) {
  const value = process.env[env]?.trim();
  return value ? path.resolve(rootDir, value) : undefined;
}

function describeRoots(config) {
  return ROOTS.map(({ name, env }) => {
    const fromEnv = envRoot(env);
    if (fromEnv) return `${name}: ${fromEnv} (from ${env})`;
    const fromConfig = config?.roots?.[name];
    if (fromConfig) return `${name}: ${fromConfig} (from ${CONFIG_FILE})`;
    return `${name}: not configured`;
  });
}

function normalizeConfig(config) {
  if (config.version === 3) {
    return {
      ...config,
      roots: isRecord(config.roots) ? config.roots : {},
      npm: isRecord(config.npm) ? config.npm : {},
    };
  }

  if (config.version === 2) {
    // A v2 config named one checkout: Sapporta's.
    return {
      version: 3,
      mode: config.mode === "local" ? "local" : "npm",
      roots: config.sapportaRoot ? { sapporta: config.sapportaRoot } : {},
      npm: isRecord(config.npm) ? config.npm : {},
      updatedAt: config.updatedAt ?? null,
    };
  }

  if (config.version !== 1) {
    throw new Error(`Unsupported ${CONFIG_FILE} version ${config.version}.`);
  }

  // v1 recorded a local and an npm source per package, so each checkout is
  // recovered by stripping that package's known directory from its link.
  const roots = {};
  const npm = {};
  for (const [packageName, source] of Object.entries(config.packages ?? {})) {
    if (typeof source?.npm === "string") npm[packageName] = source.npm;
    const root = rootFromLink(source?.local, packageName);
    if (root) roots[PACKAGE_BY_NAME.get(packageName).root] ??= root;
  }
  return {
    version: 3,
    mode: config.mode === "local" ? "local" : "npm",
    roots,
    npm,
    updatedAt: config.updatedAt ?? null,
  };
}

async function writeConfig(config) {
  await writeJsonFile(path.join(rootDir, CONFIG_FILE), config);
}

async function writeJsonFile(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function classifySource(value) {
  if (typeof value !== "string") return "other";
  if (value.startsWith("link:")) return "local";
  if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(value)) return "npm";
  return "other";
}

function getPath(object, segments) {
  let current = object;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setPath(object, segments, value) {
  const last = segments.at(-1);
  if (!last) throw new Error("Cannot set an empty path.");
  const parent = segments.slice(0, -1).reduce((current, segment) => {
    if (!isRecord(current?.[segment])) {
      throw new Error(`Missing path segment ${segments.join(".")}`);
    }
    return current[segment];
  }, object);
  parent[last] = value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHelp() {
  console.log(`Usage: pnpm package-sources <command>

Commands:
  status                  Show the configured checkouts and current sources.
  update-npm [name@version ...]
                          Record the npm versions use:npm writes. Without
                          arguments, each managed package's latest; with
                          them, exactly the versions named, keeping the
                          others already recorded.
  use:npm                 Switch all managed dependencies to npm releases.
  use:local [workspace] [--nuabase <path>]
                          Link all managed dependencies to local checkouts.
  verify                  Verify manifests, overrides, and the lockfile.

Managed packages:
  @sapporta/*   from the Sapporta checkout, under packages/
  nuabase       from the nuabase checkout, under nua-llm/nua-client

Local mode:
  Each checkout comes from its environment variable, the same way the Sapporta
  CLI names a source-linked workspace:
    export SAPPORTA_PACKAGE_ROOT=/absolute/path/to/sapporta
    export NUABASE_PACKAGE_ROOT=/absolute/path/to/nuabase

  An explicit argument overrides it for a single run:
    pnpm package-sources use:local /absolute/path/to/sapporta
    pnpm package-sources use:local --nuabase /absolute/path/to/nuabase
    pnpm package-sources use:local /path/to/sapporta --nuabase /path/to/nuabase

  A checkout already linked in package.json is remembered, so returning to
  local mode needs no paths once the config records it.

  Either way the resolved paths are stored in the gitignored ${CONFIG_FILE}
  and reused whenever the environment variables are unset. Local mode writes
  direct link: dependencies and transitive overrides in ${WORKSPACE_FILE}.

After switching:
  Run pnpm install, then pnpm package-sources:verify.`);
}
