// `dbu6/server`: what a user's project may import on the server. This list,
// `dbu6/frontend` and `dbu6/frontend.css` are the package's whole surface,
// and what we promise across versions, so a name is added here on purpose.

// What reports are written against (R1). It is a module of its own because
// our reports import it too, and this one reaches them again through
// `mount.js`: see report-kit.ts.
export * from "./report-kit.js";

// --- What dbu6.config.ts is written with (N1) ---
// The application itself (`openDbu6`, the runtime) is not exported: `dbu6
// start` runs it, and a project never opens it.
export type { Dbu6Runtime } from "./runtime.js";
export type { LoadCategorizer } from "./modules/categorization/index.js";
export { defineConfig, type Dbu6App, type Dbu6Config } from "./config.js";
export { mountApi } from "./mount.js";
