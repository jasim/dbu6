// Types for `sapporta-env.mjs`, which is plain JavaScript because
// `bin/sapporta.mjs` loads it before anything else and a project may hold dbu6
// without a build.
//
// Nothing at runtime reads this file, and `pnpm typecheck` covers `src/` only,
// so these types are for editors and for anyone importing the module rather
// than a check the build enforces: keep them in step with the code by hand.

export declare const AGENT_ENV_FILE: ".env.agent";

export declare function findProjectRoot(
  start: string,
  fileExists?: (path: string) => boolean,
): string;

export declare function sapportaEnvironment(options: {
  root: string;
  shellEnv: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}): NodeJS.ProcessEnv;
