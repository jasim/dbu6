// `dbu6/server`: what a user's project may import on the server. This list,
// `dbu6/frontend` and `dbu6/frontend.css` are the package's whole surface,
// and what we promise across versions, so a name is added here on purpose.

// What reports are written against (R1). It is a module of its own because
// our reports import it too, and this one reaches them again through
// `open.js`: see report-kit.ts.
export * from "./report-kit.js";

// --- The application ---
export {
  openDbu6Runtime,
  type Dbu6Runtime,
  type OpenDbu6RuntimeOptions,
} from "./runtime.js";
export type { LoadCategorizer } from "./modules/categorization/index.js";

// N1: the application on a project folder, and the optional dbu6.config.ts.
export { openDbu6, type OpenDbu6Options } from "./open.js";
export { defineConfig, type Dbu6App, type Dbu6Config } from "./config.js";
export { mountApi } from "./mount.js";
