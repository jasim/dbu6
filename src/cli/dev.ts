/**
 * `dbu6 dev`: the server under `node --watch`, restarted when a file it
 * imported changes, the project's `dbu6.config.ts` and report routes
 * included; and Vite when there is a frontend to hot-update.
 *
 * When node_modules/dbu6 links to dbu6's repository, the server runs compiled
 * from that checkout's dist/, which `pnpm dev` there keeps current; each
 * recompile restarts the server.
 *
 * Each child is started in a process group of its own and stopped by
 * signalling the group, so stopping `dev` by any signal leaves nothing
 * running: `node --watch` has a child of its own, and a signal sent to it
 * alone does not always take that child with it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { packageDir } from "../server/paths.js";
import { startFrontendDevServer } from "./frontend.js";

/** Runs until a child stops or a signal arrives. Returns the exit code. */
export async function runDev(root: string): Promise<number> {
  // Vite first: whether it runs decides what the server serves.
  const withVite = await startFrontendDevServer(root);
  const children = new Set<ChildProcess>();

  const start = (label: string, args: string[]) => {
    console.log(`\n> ${label}`);
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      detached: true,
    });
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  };
  const stopChildren = (signal: NodeJS.Signals) => {
    for (const child of children) {
      if (child.pid === undefined) continue;
      try {
        // The negative pid names the child's process group.
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  };

  // With Vite in front, the server serves no web app of its own.
  const serve = [packageDir("bin", "dbu6.mjs"), "serve"];
  if (withVite) serve.push("--no-frontend");
  const started = [start("API server (node --watch)", ["--watch", ...serve])];

  const stopped = new Promise<number>((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.once(signal, () => {
        stopChildren(signal);
        resolve(0);
      });
    }
    for (const child of started) {
      child.once("error", (error) => {
        console.error(error);
        resolve(1);
      });
      // A child that stops on its own takes `dev` down with it.
      child.once("exit", (code) => resolve(code ?? 1));
    }
  });
  // Whatever ends this process, the children go with it.
  process.once("exit", () => stopChildren("SIGTERM"));

  const code = await stopped;
  stopChildren("SIGTERM");
  return code;
}
