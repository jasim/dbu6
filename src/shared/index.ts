// Types, contracts, and pure helpers shared between the server (src/server)
// and the frontend (src/frontend), which import this file by relative path.
// Add anything that would otherwise be re-declared on both sides of the
// client/server boundary and drift silently when one side changes.

export const APP_NAME = "dbu6";

export * from "./contracts/index.js";
export * from "./guides.js";
