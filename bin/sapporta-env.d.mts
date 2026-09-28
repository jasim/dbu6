// Types for `sapporta-env.mjs`, which is plain JavaScript because
// `bin/sapporta.mjs` loads it before anything else and a project may hold dbu6
// without a build. Kept beside the module so Node's resolution, and therefore
// the bin's, never needs it.

export declare const PROJECT_ENV_FILE: ".env";
export declare const AGENT_ENV_FILE: ".env.agent";
export declare const SAPPORTA_ENV_FILES: readonly string[];

export declare function findProjectRoot(
  start: string,
  fileExists?: (path: string) => boolean,
): string;

export interface SapportaEnvironmentSources {
  /** `"shell"`, `".env"`, `".env.agent"`, or `port <n>` of `SAPPORTA_API_URL`. */
  apiUrl?: string;
  /** The same, of `SAPPORTA_API_TOKEN`. */
  apiToken?: string;
}

export interface SapportaEnvironment {
  env: NodeJS.ProcessEnv;
  sources: SapportaEnvironmentSources;
}

export declare function resolveSapportaEnvironment(options: {
  root: string;
  shellEnv: NodeJS.ProcessEnv;
  fileNames?: readonly string[];
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}): SapportaEnvironment;
