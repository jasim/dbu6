import { CodingAgentError } from "../modules/coding-agent/index.js";

/*
 * A coding-agent operation as a route response: its result on success, and a
 * `CodingAgentError`'s own status and payload on failure (coding-agent/
 * errors.ts). Anything else is a server fault and propagates. The two
 * functions differ only in which statuses their contract declares.
 */

type Refusal = { error: string; message: string };

function refusal(err: unknown): CodingAgentError {
  if (err instanceof CodingAgentError) return err;
  throw err;
}

/** For routes whose only failure is a refusal (400). */
export async function respondWithCodingAgentErrors<T>(
  run: () => Promise<T>,
): Promise<{ status: 200; body: T } | { status: 400; body: Refusal }> {
  try {
    return { status: 200, body: await run() };
  } catch (err) {
    const error = refusal(err);
    if (error.status !== 400) throw err;
    return { status: 400, body: error.toPayload() };
  }
}

/** For the handoff, which can also fail after writing the files (500). */
export async function respondWithHandoffErrors<T>(
  run: () => Promise<T>,
): Promise<
  | { status: 200; body: T }
  | { status: 400; body: Refusal }
  | { status: 500; body: Refusal }
> {
  try {
    return { status: 200, body: await run() };
  } catch (err) {
    const error = refusal(err);
    const body = error.toPayload();
    switch (error.status) {
      case 400:
        return { status: 400, body };
      case 500:
        return { status: 500, body };
    }
  }
}
