/*
 * Whether categorization is running in this process. An import and Run
 * categorizer are what the person waits on, so other LLM work, such as the
 * comment writer, waits for `categorizationIdle` before each call it makes.
 */

let running = 0;
let waiting: (() => void)[] = [];

/** Runs `work` counted as categorization, until it settles. */
export async function whileCategorizing<T>(work: () => Promise<T>): Promise<T> {
  running++;
  try {
    return await work();
  } finally {
    running--;
    if (running === 0) {
      const resume = waiting;
      waiting = [];
      for (const each of resume) each();
    }
  }
}

/** Settles once no categorization is running; at once when none is. */
export function categorizationIdle(): Promise<void> {
  if (running === 0) return Promise.resolve();
  return new Promise((resolve) => waiting.push(resolve));
}
