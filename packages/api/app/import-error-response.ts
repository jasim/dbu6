import type { StatementImportError } from "dbu6-shared";
import { ApiImportError } from "../modules/statement/index.js";

type ImportErrorStatus = 400 | 422;

type ImportErrorResponse =
  | { status: 400; body: StatementImportError }
  | { status: 422; body: StatementImportError };

type ImportRouteResponse<T> = { status: 200; body: T } | ImportErrorResponse;

function importErrorStatus(status: number): ImportErrorStatus {
  if (status === 400 || status === 422) return status;
  throw new Error(`Unsupported import error status ${status}`);
}

// An import error as its declared status and payload.
export function importErrorResponse(err: ApiImportError): ImportErrorResponse {
  const body = err.toPayload();
  const status = importErrorStatus(err.status);
  switch (status) {
    case 400:
      return { status, body };
    case 422:
      return { status, body };
  }
}

// An import as a route response: its result on success, and the declared
// payload of an `ApiImportError` on failure. Anything else is a server fault
// and propagates.
export async function respondWithImportErrors<T>(
  run: () => Promise<T>,
): Promise<ImportRouteResponse<T>> {
  try {
    return { status: 200, body: await run() };
  } catch (err) {
    if (!(err instanceof ApiImportError)) throw err;
    return importErrorResponse(err);
  }
}
