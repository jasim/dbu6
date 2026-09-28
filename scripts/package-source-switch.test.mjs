// Run with `pnpm test:scripts` (node --test "scripts/*.test.mjs").
//
// package-source-switch.mjs mutates the manifest and the workspace file in its
// working directory, so every test runs it in a throwaway tree shaped like
// this repository: the same managed dependencies, and stand-in checkouts
// holding the package.json files local mode validates. The child environment
// drops the checkout variables, which would otherwise outrank the fixture's.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "package-source-switch.mjs",
);

/** Mirrors the script's table: every managed package and where it lives. */
const PACKAGES = [
  { name: "@sapporta/server", root: "sapporta", dir: "packages/core" },
  { name: "@sapporta/honest", root: "sapporta", dir: "packages/honest" },
  { name: "@sapporta/shared", root: "sapporta", dir: "packages/shared" },
  { name: "@sapporta/ui", root: "sapporta", dir: "packages/ui" },
  { name: "@sapporta/grid", root: "sapporta", dir: "packages/grid" },
  { name: "@sapporta/frontend", root: "sapporta", dir: "packages/frontend" },
  { name: "nuabase", root: "nuabase", dir: "nua-llm/nua-client" },
];

const VERSIONS = {
  "@sapporta/server": "0.8.0",
  "@sapporta/honest": "0.3.16",
  "@sapporta/shared": "0.4.0",
  "@sapporta/ui": "0.4.0",
  "@sapporta/grid": "0.8.0",
  "@sapporta/frontend": "0.9.0",
  nuabase: "2.3.5",
};

const CONFIG_FILE = ".package-source-switch.json";

function packageDir(checkouts, { root, dir }) {
  return path.join(checkouts[root], dir);
}

function linkSpec(checkouts, entry) {
  return `link:${packageDir(checkouts, entry)}`;
}

/**
 * A repository with one managed dependency per package, a workspace file, an
 * optional config, and stand-in checkouts.
 *
 * @param {{ mode?: "local" | "npm", config?: object | null,
 *           lockfile?: string | null }} options
 */
function makeTree({ mode = "local", config, lockfile } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dbu6-sources-"));
  const checkouts = {
    sapporta: path.join(dir, "sapporta"),
    nuabase: path.join(dir, "nuabase"),
  };

  for (const entry of PACKAGES) {
    const directory = packageDir(checkouts, entry);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "package.json"),
      `${JSON.stringify({ name: entry.name, version: VERSIONS[entry.name] }, null, 2)}\n`,
    );
  }

  const specFor = (entry) =>
    mode === "local" ? linkSpec(checkouts, entry) : VERSIONS[entry.name];

  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "dbu6",
        version: "0.0.0",
        private: true,
        dependencies: Object.fromEntries(
          PACKAGES.map((entry) => [entry.name, specFor(entry)]),
        ),
      },
      null,
      2,
    )}\n`,
  );

  writeWorkspace(
    dir,
    mode === "local"
      ? Object.fromEntries(PACKAGES.map((entry) => [entry.name, specFor(entry)]))
      : {},
  );

  if (config !== null) {
    writeConfigFile(
      dir,
      config ?? {
        version: 3,
        mode,
        roots: { sapporta: checkouts.sapporta, nuabase: checkouts.nuabase },
        npm: VERSIONS,
        updatedAt: null,
      },
    );
  }

  writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    lockfile === undefined || lockfile === null
      ? makeLockfile(mode, checkouts)
      : lockfile,
  );

  return { dir, checkouts, cleanup: () => rmSync(dir, { force: true, recursive: true }) };
}

function writeWorkspace(dir, overrides) {
  const lines = ["# fixture", "overrides:"];
  for (const [key, value] of Object.entries(overrides)) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), `${lines.join("\n")}\n`);
}

function writeConfigFile(dir, config) {
  writeFileSync(
    path.join(dir, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

/** A lockfile agreeing with the tree, the way pnpm install would write it. */
function makeLockfile(mode, checkouts) {
  const lines = ["lockfileVersion: '9.0'", "", "overrides:"];
  for (const entry of PACKAGES) {
    const spec =
      mode === "local" ? linkSpec(checkouts, entry) : VERSIONS[entry.name];
    lines.push(`  ${JSON.stringify(entry.name)}: ${JSON.stringify(spec)}`);
  }
  lines.push("", "importers:", "", "  .:", "    dependencies:");
  for (const entry of PACKAGES) {
    const spec =
      mode === "local" ? linkSpec(checkouts, entry) : VERSIONS[entry.name];
    lines.push(
      `      ${JSON.stringify(entry.name)}:`,
      `        specifier: ${spec}`,
      `        version: ${spec}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function run(args, cwd) {
  const env = { ...process.env };
  delete env.SAPPORTA_PACKAGE_ROOT;
  delete env.NUABASE_PACKAGE_ROOT;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

const manifestOf = (dir) => readJson(path.join(dir, "package.json"));
const configOf = (dir) => readJson(path.join(dir, CONFIG_FILE));
const workspaceOf = (dir) =>
  readFileSync(path.join(dir, "pnpm-workspace.yaml"), "utf8");

test("use:npm switches nuabase too, not only Sapporta", () => {
  const tree = makeTree({ mode: "local" });
  try {
    assert.ok(
      manifestOf(tree.dir).dependencies.nuabase.startsWith("link:"),
      "precondition: nuabase starts linked",
    );

    const result = run(["use:npm"], tree.dir);
    assert.equal(result.status, 0, result.stderr);

    for (const entry of PACKAGES) {
      assert.equal(
        manifestOf(tree.dir).dependencies[entry.name],
        VERSIONS[entry.name],
        entry.name,
      );
    }
    assert.doesNotMatch(
      workspaceOf(tree.dir),
      /nuabase/,
      "the nuabase override must not survive the switch",
    );
    assert.doesNotMatch(workspaceOf(tree.dir), /link:/);
    assert.equal(configOf(tree.dir).mode, "npm");
  } finally {
    tree.cleanup();
  }
});

test("use:local links every managed package and records both checkouts", () => {
  const tree = makeTree({ mode: "npm" });
  try {
    const result = run(
      [
        "use:local",
        tree.checkouts.sapporta,
        "--nuabase",
        tree.checkouts.nuabase,
      ],
      tree.dir,
    );
    assert.equal(result.status, 0, result.stderr);

    for (const entry of PACKAGES) {
      assert.equal(
        manifestOf(tree.dir).dependencies[entry.name],
        `link:${realpathSync(packageDir(tree.checkouts, entry))}`,
        entry.name,
      );
    }
    const config = configOf(tree.dir);
    assert.equal(config.version, 3);
    assert.equal(config.roots.sapporta, realpathSync(tree.checkouts.sapporta));
    assert.equal(config.roots.nuabase, realpathSync(tree.checkouts.nuabase));
    assert.match(workspaceOf(tree.dir), /nuabase/);
  } finally {
    tree.cleanup();
  }
});

test("use:local reads a new checkout's root off the link already in package.json", () => {
  // The shape a v2 config left behind: it named only Sapporta, and nuabase is
  // already linked from the switch that added it.
  const tree = makeTree({ mode: "local", config: null });
  try {
    writeConfigFile(tree.dir, {
      version: 2,
      mode: "local",
      sapportaRoot: tree.checkouts.sapporta,
      npm: VERSIONS,
      updatedAt: null,
    });

    const result = run(["use:local"], tree.dir);
    assert.equal(result.status, 0, result.stderr);

    const config = configOf(tree.dir);
    assert.equal(config.version, 3);
    assert.equal(config.roots.sapporta, realpathSync(tree.checkouts.sapporta));
    assert.equal(config.roots.nuabase, realpathSync(tree.checkouts.nuabase));
    assert.equal(
      manifestOf(tree.dir).dependencies.nuabase,
      `link:${realpathSync(packageDir(tree.checkouts, PACKAGES.at(-1)))}`,
    );
  } finally {
    tree.cleanup();
  }
});

test("verify fails on a nuabase override left in npm mode", () => {
  const tree = makeTree({ mode: "npm" });
  try {
    // What the script did before it managed nuabase: the dependency moved to
    // npm, the override stayed.
    writeWorkspace(tree.dir, {
      nuabase: linkSpec(tree.checkouts, PACKAGES.at(-1)),
    });

    const result = run(["verify"], tree.dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /still overrides nuabase in npm mode/);
  } finally {
    tree.cleanup();
  }
});

test("verify fails on a nuabase link left in the npm-mode lockfile", () => {
  const tree = makeTree({
    mode: "npm",
    lockfile: [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      nuabase:",
      "        specifier: link:../nuabase/nua-llm/nua-client",
      "        version: link:../nuabase/nua-llm/nua-client",
      "",
    ].join("\n"),
  });
  try {
    const result = run(["verify"], tree.dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /still contains links to a checkout/);
    assert.match(result.stderr, /nuabase/);
  } finally {
    tree.cleanup();
  }
});

test("verify passes when every managed package is on npm", () => {
  const tree = makeTree({ mode: "npm" });
  try {
    const result = run(["verify"], tree.dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified the npm dependency graph/);
  } finally {
    tree.cleanup();
  }
});

test("use:npm names the package whose npm version is not recorded yet", () => {
  const tree = makeTree({ mode: "local", config: null });
  try {
    writeConfigFile(tree.dir, {
      version: 3,
      mode: "local",
      roots: { sapporta: tree.checkouts.sapporta, nuabase: tree.checkouts.nuabase },
      // Every version but nuabase's, so the report can only name nuabase.
      npm: Object.fromEntries(
        PACKAGES.filter((entry) => entry.name !== "nuabase").map((entry) => [
          entry.name,
          VERSIONS[entry.name],
        ]),
      ),
      updatedAt: null,
    });

    const result = run(["use:npm"], tree.dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing npm version for nuabase/);
    assert.match(result.stderr, /update-npm/);
  } finally {
    tree.cleanup();
  }
});

test("status reports both checkouts and every managed package", () => {
  const tree = makeTree({ mode: "npm" });
  try {
    const result = run(["status"], tree.dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Checkout sapporta:/);
    assert.match(result.stdout, /Checkout nuabase:/);
    assert.match(result.stdout, /7 of 7 managed packages/);
  } finally {
    tree.cleanup();
  }
});

test("a mistyped option is reported, not thrown as a stack trace", () => {
  const tree = makeTree({ mode: "npm" });
  try {
    const result = run(["status", "--nope"], tree.dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^package-sources: /);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  } finally {
    tree.cleanup();
  }
});
