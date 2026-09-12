import { ApiImportError } from "../bank-importer/import-errors.js";

type ImportErrorStatus = 400 | 422;
type ImportErrorPayload = {
  error: string;
  message?: string;
  detail?: string;
  hint?: string;
} & Record<string, unknown>;

type ImportRouteResponse<T> =
  | { status: 200; body: T }
  | { status: 400; body: ImportErrorPayload }
  | { status: 422; body: ImportErrorPayload };

function importErrorStatus(status: number): ImportErrorStatus {
  if (status === 400 || status === 422) return status;
  throw new Error(`Unsupported import error status ${status}`);
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
    const payload = err.toPayload();
    const body: ImportErrorPayload = {
      ...payload,
      error: typeof payload.error === "string" ? payload.error : "import_error",
    };
    const status = importErrorStatus(err.status);
    switch (status) {
      case 400:
        return { status, body };
      case 422:
        return { status, body };
    }
  }
}
