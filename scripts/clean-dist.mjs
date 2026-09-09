#!/usr/bin/env node

import { rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Clean generated package output once at dev/build startup. TypeScript leaves
// stale files in outDir after source files are deleted; in the API package,
// stale compiled schema modules are loaded and mounted by Sapporta at boot.
// Restarting with a clean dist fixes those stale-runtime errors without making
// every incremental watch rebuild pay for a full clean.
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredProjectPaths = [
  ["package.json", "file"],
  ["pnpm-workspace.yaml", "file"],
  ["packages", "directory"],
];
const cleanTargets = {
  api: { dist: "packages/api/dist", requiredFile: "packages/api/package.json" },
  shared: {
    dist: "packages/shared/dist",
    requiredFile: "packages/shared/package.json",
  },
  frontend: {
    dist: "packages/frontend/dist",
    requiredFile: "packages/frontend/package.json",
  },
};
const cleanFiles = [
  "packages/api/tsconfig.tsbuildinfo",
  "packages/frontend/tsconfig.tsbuildinfo",
  "packages/shared/tsconfig.tsbuildinfo",
];

for (const [path, kind] of requiredProjectPaths) {
  const resolvedPath = safePath(projectRoot, path);
  const entry = await stat(resolvedPath).catch(() => null);
  const matchesKind =
    (kind === "file" && entry?.isFile()) ||
    (kind === "directory" && entry?.isDirectory());

  if (!matchesKind) {
    throw new Error(
      `Refusing to clean: expected ${kind} is missing: ${resolvedPath}`,
    );
  }
}

const distDirs = [];
for (const target of Object.values(cleanTargets)) {
  const { dist, requiredFile } = target;
  const packageJson = safePath(projectRoot, requiredFile);
  const packageJsonEntry = await stat(packageJson).catch(() => null);

  if (!packageJsonEntry?.isFile()) {
    throw new Error(`Refusing to clean: package marker is missing: ${packageJson}`);
  }
  if (!dist.startsWith("packages/") || !dist.endsWith("/dist")) {
    throw new Error(`Refusing non-package dist target: ${dist}`);
  }

  distDirs.push(safePath(projectRoot, dist));
}

await Promise.all(
  distDirs.map((distDir) => rm(distDir, { force: true, recursive: true })),
);

await Promise.all(
  cleanFiles.map((file) => rm(safePath(projectRoot, file), { force: true })),
);

function safePath(root, relativePath) {
  if (isAbsolute(relativePath)) {
    throw new Error(`Refusing absolute clean path: ${relativePath}`);
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relativePath);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);

  if (
    pathFromRoot === "" ||
    pathFromRoot.startsWith("..") ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Refusing to clean outside project root: ${resolvedPath}`);
  }

  return resolvedPath;
}
