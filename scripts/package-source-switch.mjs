#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_FILE = ".package-source-switch.json";
const WORKSPACE_FILE = "pnpm-workspace.yaml";
const SOURCE_LINK_RUNTIME = "@sapporta/server/source-link-runtime";
const SAPPORTA_ROOT_ENV = "SAPPORTA_PACKAGE_ROOT";
const DEPENDENCY_KEYS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);
const IGNORED_DIRS = new Set([
  ".git",
  ".astro",
  ".vite",
  "data",
  "dist",
  "node_modules",
]);
const SAPPORTA_PACKAGE_DIRS = new Map([
  ["@sapporta/server", "core"],
  ["@sapporta/honest", "honest"],
  ["@sapporta/shared", "shared"],
  ["@sapporta/ui", "ui"],
  ["@sapporta/grid", "grid"],
  ["@sapporta/frontend", "frontend"],
]);

const rootDir = process.cwd();
const command = process.argv[2] ?? "help";

switch (command) {
  case "status":
    await showStatus();
    break;
  case "update-npm":
    await updateNpmVersions();
    break;
  case "use:npm":
    await switchSources("npm");
    break;
  case "use:local":
    await switchSources("local", process.argv[3]);
    break;
  case "verify":
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

async function showStatus() {
  const config = await readConfigIfPresent();
  const manifests = await readManifestFiles();
  const locations = findSapportaLocations(manifests);
  const workspaceOverrides = await readWorkspaceOverrides();
  const counts = { local: 0, npm: 0, other: 0 };

  for (const location of locations) {
    const value = getPath(
      manifests.find((manifest) => manifest.file === location.file)?.json,
      location.path,
    );
    counts[classifySource(value)] += 1;
  }

  console.log(`Config: ${CONFIG_FILE} ${config ? "present" : "missing"}`);
  console.log(`Configured mode: ${config?.mode ?? "unknown"}`);
  console.log(`Sapporta workspace: ${describeSapportaRoot(config)}`);
  console.log(
    `Direct entries: ${locations.length} ` +
      `(local ${counts.local}, npm ${counts.npm}, other ${counts.other})`,
  );

  const overrideCounts = { local: 0, npm: 0, other: 0, missing: 0 };
  for (const packageName of SAPPORTA_PACKAGE_DIRS.keys()) {
    const value = workspaceOverrides.get(packageName);
    if (value === undefined) overrideCounts.missing += 1;
    else overrideCounts[classifySource(value)] += 1;
  }
  console.log(
    `Workspace overrides: local ${overrideCounts.local}, ` +
      `npm ${overrideCounts.npm}, other ${overrideCounts.other}, ` +
      `missing ${overrideCounts.missing}`,
  );
}

async function updateNpmVersions() {
  const config = await readConfig();
  const manifests = await readManifestFiles();
  const packageNames = new Set([
    ...findSapportaLocations(manifests).map((location) => location.packageName),
    ...Object.keys(config.npm),
  ]);

  if (packageNames.size === 0) {
    throw new Error("No Sapporta package dependencies were found.");
  }

  for (const packageName of [...packageNames].sort()) {
    const latest = await fetchLatestVersion(packageName);
    config.npm[packageName] = latest;
    console.log(`${packageName}: ${latest}`);
  }

  config.updatedAt = new Date().toISOString();
  await writeConfig(config);
  console.log(`Wrote ${CONFIG_FILE}`);
}

async function switchSources(target, requestedSapportaRoot) {
  const config = await readConfig();
  if (requestedSapportaRoot) {
    config.sapportaRoot = path.resolve(rootDir, requestedSapportaRoot);
  }

  const manifests = await readManifestFiles();
  const locations = findSapportaLocations(manifests);
  if (locations.length === 0) {
    throw new Error("No Sapporta package dependencies were found.");
  }

  const sourceByPackage =
    target === "local"
      ? await localSources(config)
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

  setApiSourceLinkRuntime(manifests, target === "local", changedFiles);
  const migratedOverrides = migrateRootPnpmOverrides(manifests, changedFiles);

  for (const manifest of manifests) {
    if (!changedFiles.has(manifest.file)) continue;
    await writeJsonFile(path.join(rootDir, manifest.file), manifest.json);
  }

  await updateWorkspaceOverrides({
    migratedOverrides,
    sapportaSources: target === "local" ? sourceByPackage : new Map(),
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
  console.log(`Verified ${config.mode} Sapporta dependency graph.`);
}

async function verifyManifestState(mode, config) {
  if (mode !== "local" && mode !== "npm") {
    throw new Error(`Unknown configured mode "${mode}".`);
  }

  const manifests = await readManifestFiles();
  const locations = findSapportaLocations(manifests);
  const expectedSources =
    mode === "local"
      ? await localSources(config)
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

  const workspaceOverrides = await readWorkspaceOverrides();
  for (const packageName of SAPPORTA_PACKAGE_DIRS.keys()) {
    const actual = workspaceOverrides.get(packageName);
    if (mode === "local") {
      const expected = expectedSources.get(packageName);
      if (actual !== expected) {
        errors.push(
          `${WORKSPACE_FILE} override ${packageName} is ${JSON.stringify(actual)}; ` +
            `expected ${JSON.stringify(expected)}`,
        );
      }
    } else if (actual !== undefined) {
      errors.push(
        `${WORKSPACE_FILE} still overrides ${packageName} in npm mode`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Sapporta source verification failed:\n- ${errors.join("\n- ")}`);
  }
}

async function verifyLockfile(mode) {
  const lockfilePath = path.join(rootDir, "pnpm-lock.yaml");
  if (!existsSync(lockfilePath)) {
    throw new Error("pnpm-lock.yaml is missing. Run pnpm install first.");
  }
  const lockfile = await readFile(lockfilePath, "utf8");
  const firstPartyNames = [...SAPPORTA_PACKAGE_DIRS.keys()];

  if (mode === "local") {
    const registryEntries = firstPartyNames.flatMap((packageName) => {
      const escaped = escapeRegExp(packageName);
      return (
        lockfile.match(new RegExp(`^ {2}'?${escaped}@(?!link:)`, "gm")) ?? []
      );
    });
    const packedEntries =
      lockfile.match(/(?:file:)[^\n]*sapporta[^\n]*\.tgz/gi) ?? [];
    if (registryEntries.length > 0 || packedEntries.length > 0) {
      throw new Error(
        [
          "Local mode lockfile contains non-linked Sapporta packages.",
          ...registryEntries,
          ...packedEntries,
        ].join("\n"),
      );
    }
  } else if (/\blink:[^\n]*\/sapporta\/packages\//.test(lockfile)) {
    throw new Error("npm mode lockfile still contains Sapporta workspace links.");
  }
}

async function localSources(config) {
  const sapportaRoot = config.sapportaRoot;
  if (!sapportaRoot) {
    throw new Error(
      `No Sapporta workspace configured. Set ${SAPPORTA_ROOT_ENV} or run ` +
        `"pnpm package-sources use:local /absolute/path/to/sapporta".`,
    );
  }

  const canonicalRoot = await realpath(sapportaRoot).catch(() => undefined);
  if (!canonicalRoot) {
    throw new Error(`Sapporta workspace does not exist: ${sapportaRoot}`);
  }

  const sources = new Map();
  for (const [packageName, packageDir] of SAPPORTA_PACKAGE_DIRS) {
    const packageRoot = path.join(canonicalRoot, "packages", packageDir);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error(`Missing ${packageJsonPath}`);
    }
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (packageJson.name !== packageName) {
      throw new Error(
        `${packageJsonPath} is ${JSON.stringify(packageJson.name)}, ` +
          `expected ${JSON.stringify(packageName)}`,
      );
    }
    sources.set(packageName, `link:${packageRoot}`);
  }

  config.sapportaRoot = canonicalRoot;
  return sources;
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

function setApiSourceLinkRuntime(manifests, enabled, changedFiles) {
  const apiManifest = manifests.find(
    (manifest) => manifest.file === "packages/api/package.json",
  );
  if (!apiManifest) return;

  for (const scriptName of ["dev", "start"]) {
    const script = apiManifest.json.scripts?.[scriptName];
    if (typeof script !== "string") continue;
    const withoutRuntime = script.replace(
      `node --import ${SOURCE_LINK_RUNTIME}`,
      "node",
    );
    const next = enabled
      ? withoutRuntime.replace("node", `node --import ${SOURCE_LINK_RUNTIME}`)
      : withoutRuntime;
    if (next !== script) {
      apiManifest.json.scripts[scriptName] = next;
      changedFiles.add(apiManifest.file);
    }
  }
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
  await walk(rootDir, async (file) => {
    if (path.basename(file) !== "package.json") return;
    const relativeFile = path.relative(rootDir, file);
    const json = JSON.parse(await readFile(file, "utf8"));
    files.push({ file: normalizePath(relativeFile), json });
  });
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

async function walk(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(absolute, onFile);
      continue;
    }
    if (entry.isFile()) await onFile(absolute);
  }
}

function findSapportaLocations(manifests) {
  const locations = [];
  for (const manifest of manifests) {
    collectSapportaLocations(manifest.json, [], manifest.file, locations);
  }
  return locations.sort((a, b) =>
    `${a.file}:${a.path.join(".")}`.localeCompare(
      `${b.file}:${b.path.join(".")}`,
    ),
  );
}

function collectSapportaLocations(value, segments, file, locations) {
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const parentKey = segments.at(-1);
    if (
      typeof child === "string" &&
      DEPENDENCY_KEYS.has(parentKey) &&
      SAPPORTA_PACKAGE_DIRS.has(key)
    ) {
      locations.push({
        file,
        path: [...segments, key],
        packageName: key,
      });
      continue;
    }
    collectSapportaLocations(child, [...segments, key], file, locations);
  }
}

async function readWorkspaceOverrides() {
  const workspacePath = path.join(rootDir, WORKSPACE_FILE);
  const source = await readFile(workspacePath, "utf8");
  return parseTopLevelStringMap(source, "overrides").values;
}

async function updateWorkspaceOverrides({
  migratedOverrides,
  sapportaSources,
}) {
  const workspacePath = path.join(rootDir, WORKSPACE_FILE);
  const source = await readFile(workspacePath, "utf8");
  const parsed = parseTopLevelStringMap(source, "overrides");
  const values = new Map(parsed.values);

  for (const [key, value] of migratedOverrides) {
    if (!values.has(key)) values.set(key, String(value));
  }
  for (const packageName of SAPPORTA_PACKAGE_DIRS.keys()) {
    values.delete(packageName);
  }
  for (const [packageName, spec] of sapportaSources) {
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
  const config = (await readConfigIfPresent()) ?? {
    version: 2,
    mode: "npm",
    sapportaRoot: undefined,
    npm: {},
    updatedAt: null,
  };
  // SAPPORTA_PACKAGE_ROOT is the variable the Sapporta CLI already reads when
  // it scaffolds source-linked projects, so one setting drives both. An
  // explicit "use:local <workspace>" argument still wins: switchSources
  // applies it after this.
  const fromEnv = envSapportaRoot();
  if (fromEnv) config.sapportaRoot = fromEnv;
  return config;
}

function envSapportaRoot() {
  const value = process.env[SAPPORTA_ROOT_ENV]?.trim();
  return value ? path.resolve(rootDir, value) : undefined;
}

function describeSapportaRoot(config) {
  const fromEnv = envSapportaRoot();
  if (fromEnv) return `${fromEnv} (from ${SAPPORTA_ROOT_ENV})`;
  if (config?.sapportaRoot) {
    return `${config.sapportaRoot} (from ${CONFIG_FILE})`;
  }
  return "not configured";
}

function normalizeConfig(config) {
  if (config.version === 2) return config;
  if (config.version !== 1) {
    throw new Error(`Unsupported ${CONFIG_FILE} version ${config.version}.`);
  }

  const sapportaRoot = Object.values(config.packages ?? {})
    .map((source) => source?.local)
    .filter((source) => typeof source === "string" && source.startsWith("link:"))
    .map(sapportaRootFromLink)
    .find(Boolean);

  return {
    version: 2,
    mode: config.mode === "local" ? "local" : "npm",
    sapportaRoot,
    npm: Object.fromEntries(
      Object.entries(config.packages ?? {}).flatMap(([packageName, source]) =>
        typeof source?.npm === "string" ? [[packageName, source.npm]] : [],
      ),
    ),
    updatedAt: config.updatedAt ?? null,
  };
}

function sapportaRootFromLink(spec) {
  const packagePath = spec.slice("link:".length);
  const marker = `${path.sep}packages${path.sep}`;
  const markerIndex = packagePath.lastIndexOf(marker);
  return markerIndex === -1 ? undefined : packagePath.slice(0, markerIndex);
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

function normalizePath(file) {
  return file.split(path.sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHelp() {
  console.log(`Usage: pnpm package-sources <command>

Commands:
  status                  Show the configured workspace and current sources.
  update-npm              Refresh stored npm release versions.
  use:npm                 Switch all Sapporta dependencies to npm releases.
  use:local [workspace]   Link all Sapporta dependencies to one checkout.
  verify                  Verify manifests, overrides, and the lockfile.

Local mode:
  The Sapporta checkout path comes from ${SAPPORTA_ROOT_ENV}, the same
  variable the Sapporta CLI reads for source-linked scaffolds:
    export ${SAPPORTA_ROOT_ENV}=/absolute/path/to/sapporta

  An explicit argument overrides it for a single run:
    pnpm package-sources use:local /absolute/path/to/sapporta

  Either way the resolved path is stored in the gitignored ${CONFIG_FILE}
  and reused whenever ${SAPPORTA_ROOT_ENV} is unset. Local mode writes
  direct link: dependencies and transitive overrides in ${WORKSPACE_FILE}.

After switching:
  Run pnpm install, then pnpm package-sources:verify.`);
}
