import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { build, type Plugin } from "vite";
import {
  createHostViteConfig,
  packageDir,
  PROJECT_FRONTEND_GLOBS,
  projectAppDir,
} from "./config.js";

/*
 * Which web app a project is served. A project that adds nothing to the
 * frontend is served the app prebuilt in the package, and nothing is built.
 * One with reports or a frontend.tsx gets its own build in <root>/dist/app,
 * made again only when what went into it changed.
 *
 * What went into it is recorded beside it, in BUILD_RECORD: the project's
 * files the bundler read (so a screen's helper outside reports/ counts), the
 * entry files there were, and this dbu6. A build is stale when any of the
 * three differs now.
 */

const BUILD_RECORD = ".dbu6-build.json";

interface BuildRecord {
  /** The dbu6 that built it: its version and its compiled frontend. */
  dbu6: string;
  /** The report definitions and frontend.tsx the entry loaded, sorted. */
  entries: string[];
  /** Every file of the project in the bundle, by path from the root. */
  files: Record<string, string>;
}

export interface ProjectFrontend {
  /**
   * False when the project has no `reports/<id>/report.ts(x)` and no
   * `frontend.tsx`: it is served the prebuilt app and never built.
   */
  needsBuild: boolean;
  /**
   * True when `needsBuild` and `<root>/dist/app` is missing, or was built
   * from other reports, another frontend.tsx or another dbu6.
   */
  stale: boolean;
  /** The directory to serve: `<root>/dist/app`, or the package's. */
  appDir: string;
  /** The report definitions and frontend.tsx the entry loads, sorted. */
  entries: string[];
}

/** Reads the project; builds nothing. */
export function projectFrontend(root: string): ProjectFrontend {
  const entries = entryFiles(root);
  if (entries.length === 0) {
    return {
      needsBuild: false,
      stale: false,
      appDir: path.join(packageDir, "dist/app"),
      entries,
    };
  }
  const appDir = projectAppDir(root);
  return { needsBuild: true, stale: isStale(root, entries), appDir, entries };
}

/**
 * Builds the project's app into `<root>/dist/app` and records what went into
 * it. Does nothing for a project that needs no build. `force: false` also
 * skips a build that is not stale, which is what `start` wants; `dbu6 build`
 * builds regardless.
 */
export async function buildProjectFrontend(
  root: string,
  { force = true }: { force?: boolean } = {},
): Promise<ProjectFrontend & { built: boolean }> {
  const before = projectFrontend(root);
  if (!before.needsBuild || (!force && !before.stale)) {
    return { ...before, built: false };
  }
  const bundled = new Set<string>();
  const record: Plugin = {
    name: "dbu6:build-record",
    buildEnd() {
      for (const id of this.getModuleIds()) bundled.add(id);
    },
  };
  const config = createHostViteConfig({ projectRoot: root });
  await build({ ...config, plugins: [...(config.plugins ?? []), record] });

  const files: Record<string, string> = {};
  for (const id of bundled) {
    const file = id.split("?")[0]!;
    const relative = path.relative(root, file);
    if (
      !path.isAbsolute(file) ||
      relative.startsWith("..") ||
      relative.split(path.sep).includes("node_modules") ||
      !fs.existsSync(file)
    ) {
      continue;
    }
    files[relative] = hashOf(fs.readFileSync(file));
  }
  const written: BuildRecord = {
    dbu6: dbu6Fingerprint(),
    entries: before.entries,
    files,
  };
  fs.writeFileSync(
    path.join(projectAppDir(root), BUILD_RECORD),
    JSON.stringify(written, null, 2) + "\n",
  );
  return { ...before, stale: false, built: true };
}

function entryFiles(root: string): string[] {
  return Object.values(PROJECT_FRONTEND_GLOBS)
    .flatMap((pattern) => fs.globSync(pattern, { cwd: root }))
    .sort();
}

function isStale(root: string, entries: string[]): boolean {
  const appDir = projectAppDir(root);
  let record: BuildRecord;
  try {
    record = JSON.parse(
      fs.readFileSync(path.join(appDir, BUILD_RECORD), "utf8"),
    ) as BuildRecord;
  } catch {
    return true;
  }
  if (!fs.existsSync(path.join(appDir, "index.html"))) return true;
  if (record.dbu6 !== dbu6Fingerprint()) return true;
  if (JSON.stringify(record.entries) !== JSON.stringify(entries)) return true;
  return Object.entries(record.files).some(([relative, hash]) => {
    const file = path.join(root, relative);
    return !fs.existsSync(file) || hashOf(fs.readFileSync(file)) !== hash;
  });
}

/**
 * The version alone would miss a tarball rebuilt under the same version, so
 * the compiled frontend and its stylesheet count too.
 */
function dbu6Fingerprint(): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(path.join(packageDir, "package.json")));
  for (const file of ["dist/frontend/index.js", "dist/frontend/frontend.css"]) {
    const full = path.join(packageDir, file);
    if (fs.existsSync(full)) hash.update(fs.readFileSync(full));
  }
  return hash.digest("hex");
}

function hashOf(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
