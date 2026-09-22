# Frontend host: findings from the D1 spike

Written for whoever does D7, D8 and R1–R3. The spike asked whether a user's
project, a folder outside this repo with `dbu6` installed from a tarball under
npm, can have its own React report screens built into the app. It can, and the
host is small. Everything below was run, not reasoned.

> **Since D7** the host lives in `src/frontend-host/`, and the pieces this
> note asks for exist: `scripts/build.mjs` makes `dist/frontend` and builds
> `dist/app` through the host, `ownFrontend: "src"` is the source mode
> `pnpm dev` uses, `src/frontend/frontend.css` carries no
> `@import "tailwindcss"` so it is copied unchanged, declarations come from
> `tsc`, and `scripts/verify-tarball.mjs` installs the tarball under npm. The
> entry does not glob the project yet; R2 adds that, in the form shown below.
> Paths under `packages/` below are the layout the spike was written against.

## What was proved

In a scratch project (`my-books/`: a `package.json` whose one dependency is the
`dbu6` tarball, a `tsconfig.json`, `reports/dining-by-weekday/{Screen.tsx,report.ts}`
and a `frontend.tsx`), with no Vite config, no `index.html` and no CSS file of
its own:

- `npx dbu6 build` writes `dist/app/`. The built CSS holds `border-fuchsia-500`,
  `rotate-[1.5deg]`, `outline-lime-600` and `decoration-teal-400`, classes that
  appear only in the project's files, next to dbu6's own theme
  (`text-body`, `--sap-brand`, `.accounts-grid`). A project with no reports
  builds the same CSS without them.
- Served with `vite preview` and opened in headless Chromium, the user's screen
  renders with those classes applied (computed `border-left-color`, `rotate`),
  in dbu6's font, with `useQuery` working against the app's
  `QueryClientProvider` and `<Link>` inside the app's router.
- `npx dbu6 dev` serves the same page. Editing `Screen.tsx` hot-updates it with
  component state kept, and a Tailwind class that was used nowhere before shows
  up styled without a reload. Editing `report.ts` or `frontend.tsx`, or adding a
  new `reports/<id>/` folder, hot-updates the entry with no page reload.
- The bundle holds one copy each of react, react-dom, react-router,
  @tanstack/react-query, @tanstack/query-core, zustand, @base-ui/react,
  lucide-react, use-sync-external-store and the three @sapporta frontend
  packages (checked by listing module ids in the bundle,
  `verify/single-copy.mjs`). At runtime, `useState` imported from `"react"` and
  from `"dbu6/frontend"` are the same function.
- `tsc --noEmit` passes over the project with only `dbu6` installed.

The real dbu6 frontend was used (a copy of `packages/frontend/src` and
`packages/shared/src`), not a toy. There was no backend: the screens were
mounted on public routes through a spike-only `publicRoutes` extension field so
they render outside the auth gate. The protected `reports/<id>` route is wired
the same way but was not opened in a browser, since that needs a session.

## Decisions for D7, D8, R1

### The host consumes our frontend as compiled JS, plus CSS that is Tailwind source

This is what Sapporta's packages already do, and it is the form that works.

- **JS**: a Vite library build of `src/frontend/index.ts`, ES format, with every
  bare import left external
  (`external: (id) => !id.startsWith(".") && !path.isAbsolute(id)`), unminified,
  with sourcemaps. `dbu6-shared` is bundled in (in D7 it is a relative import,
  so this falls out). Because react, react-router, @sapporta/* and the rest stay
  as imports, the host's bundler resolves them once for our code and the
  user's.
- **CSS**: `dist/frontend/frontend.css` is `app.css` copied, not compiled, with
  one line removed (`@import "tailwindcss";`). Its `@source "./";` now sits next
  to the compiled JS and scans that. Class names survive compilation as string
  literals. `verify/css-parity.mjs` compiled the stylesheet against `src/` and
  against `dist/frontend/` and compared selectors: the compiled-JS run had no
  selector the source run lacked, and lacked 17, all of them from files nothing
  imports (`components/progress-steps.tsx`, `components/transaction-row.tsx`,
  `components/category-label.tsx`), so tree-shaking removed them. That is
  correct behaviour, but it means a class name must be in a module that is
  reachable from the entry. It always is for code that renders.
- There is **one Tailwind run**, in the host, over our compiled JS and the
  user's files together. Shipping precompiled CSS and running a second Tailwind
  for the user's classes was rejected without being built: two runs mean two
  preflights and two theme layers, and the user's utilities would not see our
  `@theme` tokens (`text-body`, `bg-attention-surface`) unless the theme were
  shipped as source anyway.

The `@import "tailwindcss"` line moves to the host because it needs an option
only the host should decide (`source(none)`, below), and an `@import` that is
repeated cannot be re-configured. Consequence: `dbu6/frontend.css` is not a
standalone stylesheet. Nothing but the host imports it. `start.tsx` (today's
`main.tsx`) no longer imports any CSS.

**Our own app should be built by the same host.** `dist/app` (the prebuilt web
app) is `buildHost` run against a project with no `reports/` and no
`frontend.tsx`; the spike's `empty-project/` is exactly that and builds. D7 can
drop `packages/frontend/vite.config.ts` and `index.html` rather than keep a
second pipeline. For `pnpm dev` in this repo the host needs a source mode
(resolve `dbu6/frontend` to `src/frontend/index.ts` and `@source` to
`src/frontend`), which the spike did not build.

### React and friends are plain dependencies, re-exported by us. No peers.

The user's `package.json` has one dependency. It works because npm hoists
dbu6's dependencies into the project's `node_modules`, so a user's file and
our compiled JS resolve the same `react`.

- `dbu6/frontend` re-exports what reports need (`useState`, `Link`, `useQuery`
  and so on). R1 picks the list. `export *` from all three packages is not
  possible as-is because names would have to be checked for collisions; named
  re-exports are what the spike did.
- A user who writes `import { useState } from "react"` also gets the same copy.
  That is a phantom dependency, fine under npm, and we cannot stop it; the guide
  should tell reports to import from `dbu6/frontend`.
- JSX needs no import in the user's file, but the automatic runtime makes their
  compiled file import `react/jsx-runtime`. That resolves through hoisting too.
  This is the one place the user's code always depends on hoisting, whatever
  they import.
- `@types/react` and `@types/react-dom` must be **dependencies** of dbu6, not
  dev dependencies, or the user's `tsc` cannot type JSX. `typescript` itself
  must be a dependency too if `dbu6 check` is to run `tsc` (the spike borrowed
  the staging package's).
- `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` and `tailwindcss` are
  dependencies as well. The tarball is 232 KB; the install is 108 packages.

**The failure case, and the guard.** If the project's `package.json` names its
own `react` at another version, npm keeps theirs at the top and nests ours
under `node_modules/dbu6/node_modules/` (along with react-dom, react-router,
@base-ui and @sapporta/*). `resolve.dedupe` then makes it worse: it resolves
from the root, so the build gets React 18 with react-dom 19. I tried forcing
every import of these packages to resolve from inside `node_modules/dbu6`. That
fixes the production build, but not dev: Vite's dependency optimizer resolves
its entries (`react/jsx-dev-runtime`, added by plugin-react) and hoisted
packages such as @tanstack/react-query from the root, with its own resolver,
and the page dies with "Invalid hook call". So the host does not try to repair
this. `assertSingleCopies` compares where each package on the list resolves
from the project and from dbu6, and refuses to start with a message naming the
package (`conflict-project/` shows it). N4's `check` should call the same
function.

Making them peers would not help: npm 7+ installs peers automatically, into the
same hoisted place, and the conflict case fails the same way with a worse
message.

### The dedupe list

```
react  react-dom  react-router  react-router-dom  @tanstack/react-query
zustand  @base-ui/react  lucide-react  use-sync-external-store
@sapporta/frontend  @sapporta/grid  @sapporta/ui  @sapporta/shared
```

The first nine are today's list in `packages/frontend/vite.config.ts` plus
`react-router` (react-router-dom 7 is a re-export of it, and the context lives
there). The @sapporta packages are added because they hold stores and contexts
(theme store, auth store, `setNavigate`). Under a plain npm install every one
of these is already single and `dedupe` does nothing; it is a net for a nested
copy pulled in by some other dependency. The `alias` block in today's config is
only needed for linked Sapporta checkouts and is not part of the host.

### The Tailwind lines

The host's stylesheet is generated, because it needs absolute paths:

```css
@import "tailwindcss" source(none);
@import "dbu6/frontend.css";
@source "/abs/path/to/my-books/reports";
@source "/abs/path/to/my-books/frontend.tsx";
@source "/abs/path/to/my-books/frontend.ts";
```

and `dbu6/frontend.css` begins:

```css
@import "@sapporta/ui/index.css";
@import "@sapporta/grid/index.css";
@import "@sapporta/frontend/index.css";
@source "./";          /* dist/frontend: our compiled JS */
```

- `source(none)` matters. Without it Tailwind scans Vite's root, which is the
  user's project: `user-config/`, the Python parsers, anything not gitignored.
  With it, only the named sources are read.
- Explicit `@source` paths into `node_modules` work (Tailwind only skips
  `node_modules` in automatic detection). Sapporta's three stylesheets each
  carry their own `@source "./"`, so their classes come along.
- A `@source` that names a file or folder that does not exist is ignored, so
  the lines are unconditional.
- Surprise: `@tailwindcss/vite` handles a **virtual** stylesheet. The id is
  `\0dbu6:host.css`; bare `@import`s inside it resolve from Vite's root, which
  finds `tailwindcss` and `dbu6` because npm hoists them. No temp file is
  written into the project.
- A user's CSS module or plain `.css` import would go through Vite as usual,
  but `@apply` or theme utilities inside it need
  `@reference "dbu6/frontend.css"` plus Tailwind itself; not tried. Reports are
  expected to use classes.

### How the entry and index.html are served from inside node_modules

Vite's **root is the user's project**, not the package. That one choice makes
the rest simple: `import.meta.glob("/reports/*/report.{ts,tsx}")` is
root-relative (the only kind a virtual module may use), project files get normal
URLs and HMR instead of `/@fs/` paths, and `cacheDir`, `outDir` and `.env` land
in the project. `configFile: false` means a stray `vite.config.*` in the
project is never read.

- **index.html** lives in the package (`dist/frontend-host/index.html`).
  - Dev: a middleware added from the function `configureServer` *returns* (so
    it runs after Vite's own, which find no `index.html` under the root and
    fall through). It answers any GET that accepts `text/html` with
    `server.transformIndexHtml(url, template)`, so plugin-react's preamble and
    the HMR client are injected as usual.
  - Build: `rollupOptions.input` is `<project>/index.html`, a path that does
    not exist. The plugin's `resolveId` claims it and `load` returns the
    template. Vite's HTML plugin then treats it as a normal input and emits
    `dist/app/index.html`. Pointing `input` at the real file under
    `node_modules` was not tried, since Vite names the output after the input's
    path relative to the root and would write it outside `outDir`.
- **The entry** is `<script type="module" src="/@dbu6/entry.js">`. `resolveId`
  maps that URL to `\0dbu6:entry.js` and `load` returns the source. It is plain
  JS (no JSX, no types), so it needs no transform. It imports the host CSS,
  globs the project, calls `startDbu6Frontend`, and accepts its own hot updates.
- The entry imports `"dbu6/frontend"` as a bare specifier, the same string the
  user's files use. This matters in dev: Vite pre-bundles it as one optimized
  dependency, and an absolute path from the entry next to a bare import from
  the user would load our module state (extension store, query client) twice.
  `optimizeDeps.include: ["dbu6/frontend"]` is needed because the entry is
  virtual and Vite's scanner never sees it; without it the first load
  discovers the dependency late and reloads.

### HMR caveats

- A user's component file: React Fast Refresh, state kept. New Tailwind
  classes arrive in the same update (the log shows `host.css` and the file
  updating together).
- `report.ts`, `frontend.tsx`, a report folder added or removed: the update
  bubbles to the entry, which accepts itself and calls `startDbu6Frontend`
  again. No page reload, but the tree is remounted, so component state is lost.
  For that to work `startDbu6Frontend` must be callable twice: it keeps the
  `createRoot` result and re-renders into it. D8 should keep that property and
  have a test for a second call.
- Our own code is compiled and pre-bundled, so it does not hot-update in a
  user's project. That is right for users; it is why this repo's `pnpm dev`
  needs the source mode mentioned above.
- After `dbu6 upgrade`, Vite's dependency cache
  (`node_modules/.vite-dbu6`) is keyed on the lockfile, so it re-optimizes on
  its own. Reinstalling a rebuilt tarball with the *same version* does not
  refresh anything: npm serves the old tarball from its cache by lockfile
  integrity. Bump the version on every hand-built pack (the spike lost ten
  minutes to this); CI for R3/N5 should use a unique prerelease version.

### The build invocation

```ts
import { build, createServer } from "vite";
await build(createHostViteConfig({ projectRoot }));                 // dbu6 build, start
const server = await createServer(createHostViteConfig({ projectRoot, port, apiPort }));
await server.listen();                                               // dbu6 dev
```

Output goes to `<project>/dist/app` (`emptyOutDir: true` is set explicitly,
because the out dir is named by absolute path). The real frontend plus one
report builds in about half a second, so R2's "build on start when something
changed" is cheap, and hashing inputs to skip it is an optimization rather than
a need.

The host is Node code that runs from `node_modules`, where Node will not strip
types, so it ships compiled (`tsc`, NodeNext) in `dist/frontend-host/`, with
`index.html` copied beside it.

### What D8 needs to know

`App.tsx` builds its route elements when the module is evaluated, so an
extension has to be set before `App.tsx` is imported. The spike's
`startDbu6Frontend` sets a module-level extension and then does
`await import("./SapportaApp")`; `App.tsx` reads `getExtension()` where it maps
`reportDefinitions`. It works and makes `SapportaApp` a separate chunk. D8
should turn the route constants into functions of the extension instead; the
spike's `extension.ts`, `start.tsx` and the `App.tsx` patch are throwaway.
`publicRoutes` on the extension exists only so the spike could render without a
backend, and should not survive.

### @sapporta/* under npm

The published registry versions were used: `@sapporta/frontend` 0.8.0,
`@sapporta/grid` 0.7.0, `@sapporta/ui` 0.3.0, `@sapporta/shared` 0.3.3,
`@sapporta/rest-core` 3.52.2. They match the local checkout's version numbers,
and the current frontend source builds and renders against them, so nothing
the frontend uses is unpublished. Packing local copies was not needed. npm
installs their peers (`@tanstack/react-form` and the rest) by itself. The
server side was not exercised; S1 changes `@sapporta/server` and will need a
release before a real tarball can depend on it.

### Small things

- `npm` in the owner's shell is a function that refuses to run ("We use pnpm in
  this house"). The spike called the binary with `command npm`. Scripts and CI
  that prove the user's path must do the same or run outside that shell.
- `publicDir: false`: a dbu6 project has no `public/`. The app currently has no
  favicon, so every page load logs one 404.
- The hand-written `dist/frontend/index.d.ts` in the spike is a placeholder. D7
  needs real declarations (Sapporta uses `vite-plugin-dts`); whatever emits
  them must not leave `dbu6-shared` or `src/`-relative paths in the output.
- `react-router-dom` never shows up in the bundle's module list. It is a pure
  re-export and is shaken away; the code comes from `react-router`.

## Where the code is

Scratch directory (under `/private/tmp`, so lift what you need before a reboot
clears it):

`<session scratchpad>/d1-spike` (the D1 task report gives the full path)

- `pkg/` — the hand-built package. `package.json` (exports, dependencies),
  `build/build.mjs` (library build, `frontend.css`, host `tsc`),
  `build/vite.lib.config.mjs`, `src/frontend-host/` (lift this into D7),
  `src/frontend/{index.ts,start.tsx,extension.ts}` and the patched `App.tsx`
  (throwaway), `bin/dbu6.mjs` (`dev` and `build` only),
  `dbu6-0.0.0-d1spike.3.tgz`.
- `my-books/` — the user project. `conflict-project/` pins its own React and
  shows the guard. `empty-project/` has no reports.
- `verify/single-copy.mjs`, `verify/css-parity.mjs` — the two checks that are
  worth turning into tests.

To run it again: `cd pkg && node build/build.mjs && command npm pack`, bump the
version if anything changed, `command npm install` in `my-books`, then
`npx dbu6 build` or `SAPPORTA_FRONTEND_PORT=5473 npx dbu6 dev` and open
`/spike/report`.

## The host, in full

`src/frontend-host/plugin.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

/** The URL the host's index.html loads. Not a file: see `load` below. */
export const ENTRY_URL = "/@dbu6/entry.js";
export const HOST_CSS_URL = "/@dbu6/host.css";
const ENTRY_ID = "\0dbu6:entry.js";
const HOST_CSS_ID = "\0dbu6:host.css";

/**
 * Packages that keep state in module scope (a context, a store, a registry),
 * so the app must load exactly one copy. `resolve.dedupe` sends every import
 * of these to the copy under the project's node_modules, and
 * `assertSingleCopies` makes sure that copy is the one dbu6 itself gets.
 */
export const SINGLE_COPY = [
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "@tanstack/react-query",
  "zustand",
  "@base-ui/react",
  "lucide-react",
  "use-sync-external-store",
  "@sapporta/frontend",
  "@sapporta/grid",
  "@sapporta/ui",
  "@sapporta/shared",
];

export interface HostPluginOptions {
  /** The user's project folder. It is Vite's root. */
  projectRoot: string;
  /** node_modules/dbu6 (or this repo's root, in development). */
  packageDir: string;
}

/**
 * Serves the three things that live in the package rather than in the user's
 * project: index.html, the entry module and the Tailwind stylesheet.
 */
export function dbu6Host({ projectRoot, packageDir }: HostPluginOptions): Plugin {
  const htmlTemplate = path.join(packageDir, "dist/frontend-host/index.html");
  // Build only: Vite wants an .html input under its root, and names the
  // output after it. This path never exists on disk; `load` supplies it.
  const virtualHtml = path.join(projectRoot, "index.html");

  return {
    name: "dbu6:host",
    enforce: "pre",

    config(_, { command }) {
      if (command !== "build") return;
      return { build: { rollupOptions: { input: virtualHtml } } };
    },

    resolveId(source) {
      if (source === ENTRY_URL) return ENTRY_ID;
      if (source === HOST_CSS_URL) return HOST_CSS_ID;
      if (source === virtualHtml) return virtualHtml;
      return null;
    },

    load(id) {
      if (id === ENTRY_ID) return entrySource();
      if (id === HOST_CSS_ID) return hostCss(projectRoot);
      if (id === virtualHtml) return fs.readFileSync(htmlTemplate, "utf8");
      return null;
    },

    configureServer(server: ViteDevServer) {
      // Returned, so it runs after Vite's own middlewares: Vite finds no
      // index.html under the project root and falls through to this.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          if (!(req.headers.accept ?? "").includes("text/html")) return next();
          try {
            const template = fs.readFileSync(htmlTemplate, "utf8");
            const html = await server.transformIndexHtml(
              req.url ?? "/",
              template,
              req.originalUrl,
            );
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}

/**
 * The entry. `import.meta.glob` patterns that start with `/` are relative to
 * Vite's root, which is the user's project, so this module finds the project's
 * files without knowing where the project is, and Vite re-runs it when a
 * report folder is added or removed.
 */
function entrySource(): string {
  return `
import "${HOST_CSS_URL}";
import { startDbu6Frontend } from "dbu6/frontend";

const reportModules = import.meta.glob("/reports/*/report.{ts,tsx}", {
  eager: true,
  import: "default",
});
const frontendModules = import.meta.glob("/frontend.{ts,tsx}", {
  eager: true,
  import: "default",
});

const reports = Object.entries(reportModules).map(([file, definition]) => {
  if (!definition || typeof definition !== "object") {
    throw new Error(file + " must default-export a report definition.");
  }
  return definition;
});
const extension = Object.values(frontendModules)[0] ?? {};

startDbu6Frontend({ ...extension, reports: [...reports, ...(extension.reports ?? [])] });

if (import.meta.hot) import.meta.hot.accept();
`;
}

/**
 * One Tailwind run for the whole app. `dbu6/frontend.css` names its own
 * compiled JS as a source; the project's files are added here by absolute
 * path, because a stylesheet inside node_modules cannot know where the
 * project is. `source(none)` turns off Tailwind's scan of the Vite root, so
 * data/, user-config/ and the Python parsers are never read for class names.
 */
function hostCss(projectRoot: string): string {
  const sources = [
    path.join(projectRoot, "reports"),
    path.join(projectRoot, "frontend.tsx"),
    path.join(projectRoot, "frontend.ts"),
  ];
  return [
    `@import "tailwindcss" source(none);`,
    `@import "dbu6/frontend.css";`,
    ...sources.map((source) => `@source ${JSON.stringify(source)};`),
  ].join("\n");
}
```

`src/frontend-host/config.ts`

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { InlineConfig } from "vite";
import { dbu6Host, SINGLE_COPY } from "./plugin.js";
import { assertSingleCopies } from "./single-copy.js";

export { SINGLE_COPY } from "./plugin.js";

// dist/frontend-host/config.js -> the package directory.
const packageDir = path.resolve(import.meta.dirname, "../..");

export interface HostConfigOptions {
  projectRoot: string;
  apiPort?: number;
  port?: number;
}

export function createHostViteConfig({
  projectRoot,
  apiPort = 3000,
  port = 5173,
}: HostConfigOptions): InlineConfig {
  assertSingleCopies(projectRoot, packageDir);
  return {
    // Never read a vite.config from the user's project: there is none, and
    // one left by accident must not change how dbu6 builds.
    configFile: false,
    root: projectRoot,
    // A public/ folder is not part of a dbu6 project; do not serve one that
    // happens to exist.
    publicDir: false,
    cacheDir: path.join(projectRoot, "node_modules/.vite-dbu6"),
    plugins: [dbu6Host({ projectRoot, packageDir }), react(), tailwindcss()],
    resolve: { dedupe: SINGLE_COPY },
    optimizeDeps: {
      // The entry is virtual, so Vite's scan of the project finds only what
      // the user's files import. Name ours, or the first page load discovers
      // it late and reloads.
      include: ["dbu6/frontend"],
    },
    server: {
      port,
      strictPort: true,
      proxy: { "/api": `http://localhost:${apiPort}` },
    },
    build: {
      outDir: path.join(projectRoot, "dist/app"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("@js-temporal/polyfill")) return "temporal";
          },
        },
      },
    },
  };
}
```

`src/frontend-host/single-copy.ts`

```ts
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
export function assertSingleCopies(projectRoot: string, packageDir: string): void {
  const fromProject = createRequire(path.join(projectRoot, "package.json"));
  const fromPackage = createRequire(path.join(packageDir, "package.json"));
  const conflicts: string[] = [];
  for (const name of SINGLE_COPY) {
    const ours = packageJsonOf(fromPackage, name);
    const theirs = packageJsonOf(fromProject, name);
    if (ours && theirs && fs.realpathSync(ours) !== fs.realpathSync(theirs)) {
      conflicts.push(`${name}: the project resolves ${theirs}, dbu6 resolves ${ours}`);
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
```

`src/frontend-host/index.ts`

```ts
import { build, createServer, type ViteDevServer } from "vite";
import { createHostViteConfig, type HostConfigOptions } from "./config.js";

export { createHostViteConfig, SINGLE_COPY } from "./config.js";

export async function startHostDevServer(
  options: HostConfigOptions,
): Promise<ViteDevServer> {
  const server = await createServer(createHostViteConfig(options));
  await server.listen();
  server.printUrls();
  return server;
}

export async function buildHost(options: HostConfigOptions): Promise<void> {
  await build(createHostViteConfig(options));
}
```

`src/frontend-host/index.html` is today's `packages/frontend/index.html` with
the script tag changed to `<script type="module" src="/@dbu6/entry.js"></script>`.
