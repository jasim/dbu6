import { styleText } from "node:util";

/**
 * Where a person opens dbu6. The server prints it once its startup logs
 * settle (mount.ts), and `dev` also prints it first when it knows it, with
 * Vite in front, so it is on the screen from the start. Kept apart from the
 * server so `dev` prints it without loading the server.
 */
export function printAppUrl(url: string): void {
  const link = styleText(["bold", "cyan"], url);
  console.log(`\n\n  Open ${link} in your browser to use dbu6.\n\n`);
}
