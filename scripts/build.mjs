#!/usr/bin/env node

// Builds the package's dist/:
//
//   dist/server, dist/shared, dist/frontend-host, dist/cli   tsc, the Node side
//   dist/frontend    `dbu6/frontend`: a Vite library build with every bare
//                    import left external, its declarations, and
//                    frontend.css copied as Tailwind source
//   dist/app         the prebuilt web app, built by the frontend host from
//                    dist/frontend, the way a user's project builds theirs
//
// docs/frontend-host-findings.md explains why the frontend ships in this form.
// `--node` stops after the first step, which is all `pnpm dev` needs.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tsc = path.join(root, "node_modules/typescript/bin/tsc");
const nodeOnly = process.argv.includes("--node");

function run(label, args) {
  console.log(`\n> ${label}`);
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

run("Compile the Node side", [tsc, "-p", "tsconfig.json"]);
// The host reads its index.html from beside its compiled modules.
copyFileSync(
  path.join(root, "src/frontend-host/index.html"),
  path.join(root, "dist/frontend-host/index.html"),
);
// `dbu6 seed --statements` runs this script from beside its compiled module.
copyFileSync(
  path.join(root, "src/server/seed/render-statements.py"),
  path.join(root, "dist/server/seed/render-statements.py"),
);
if (nodeOnly) process.exit(0);

console.log("\n> Build dbu6/frontend");
const { build } = await import("vite");
const { default: react } = await import("@vitejs/plugin-react");
await build({
  root,
  configFile: false,
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: path.join(root, "dist/frontend"),
    emptyOutDir: true,
    sourcemap: true,
    // Readable in a user's node_modules; their build minifies the app.
    minify: false,
    lib: { entry: path.join(root, "src/frontend/index.ts"), formats: ["es"] },
    rollupOptions: {
      // Every bare import stays an import, so the host's bundler resolves
      // react, react-router and @sapporta/* once for our code and the user's.
      // src/shared is a relative import, so it is bundled in.
      external: (id) => !id.startsWith(".") && !path.isAbsolute(id),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
// Tailwind source, not compiled CSS: its `@source "./"` now names the compiled
// JS beside it, where every class name survives as a string.
copyFileSync(
  path.join(root, "src/frontend/frontend.css"),
  path.join(root, "dist/frontend/frontend.css"),
);
// Declarations come from tsc, one per source file, under the same dist/ the
// Node side wrote, so a relative import of ../shared resolves to dist/shared's.
run("Emit dbu6/frontend's declarations", [
  tsc,
  "-p",
  "src/frontend",
  "--noEmit",
  "false",
  "--declaration",
  "--emitDeclarationOnly",
  "--outDir",
  "dist",
]);

console.log("\n> Build the prebuilt app");
const { buildHost } = await import("../dist/frontend-host/index.js");
await buildHost({ projectRoot: root, ownFrontend: "dist" });
