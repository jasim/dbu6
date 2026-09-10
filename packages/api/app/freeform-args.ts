import { parseAccount } from "../bank-importer/domain/Account.js";
import {
  ApiImportError,
  runFreeformImport,
  type FreeformImportArgs,
  type ImportOptions,
} from "../bank-importer/freeform-import.js";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";

type ImportErrorStatus = 400 | 422 | 502;
type ImportErrorPayload = {
  error: string;
  message?: string;
  detail?: string;
  hint?: string;
} & Record<string, unknown>;

type ImportRouteResponse<T> =
  | { status: 200; body: T }
  | { status: 400; body: ImportErrorPayload }
  | { status: 422; body: ImportErrorPayload }
  | { status: 502; body: ImportErrorPayload };

class MultipartFieldMissingError extends ApiImportError {
  readonly status = 400;

  constructor(readonly field: string) {
    super(`Missing '${field}' field`);
    this.name = "MultipartFieldMissingError";
  }

  toPayload(): ImportErrorPayload {
    return {
      error: "missing_multipart_field",
      message: this.message,
      field: this.field,
    };
  }
}

class InvalidMultipartNumberError extends ApiImportError {
  readonly status = 400;

  constructor(
    readonly field: string,
    readonly suppliedValue: unknown,
  ) {
    super(
      `Invalid '${field}' value: expected a finite signed decimal number or a blank value.`,
    );
    this.name = "InvalidMultipartNumberError";
  }

  toPayload(): ImportErrorPayload {
    return {
      error: "invalid_multipart_number",
      message: this.message,
      field: this.field,
      supplied_value: this.suppliedValue,
    };
  }
}

function parseOptionalMoneyField(
  body: Record<string, unknown>,
  field: string,
): number | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new InvalidMultipartNumberError(field, raw);
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    throw new InvalidMultipartNumberError(field, raw);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new InvalidMultipartNumberError(field, raw);
  }
  const sign = parsed < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(parsed) + Number.EPSILON) * 100)) / 100;
}

function toLedgerBalance(value: number | null, isCreditCard: boolean) {
  if (value === null || !isCreditCard) return value;
  if (value === 0) return 0;
  return -Math.abs(value);
}

function importErrorPayload(err: ApiImportError): ImportErrorPayload {
  const payload = err.toPayload();
  return {
    ...payload,
    error: typeof payload.error === "string" ? payload.error : "import_error",
  };
}

function importErrorStatus(status: number): ImportErrorStatus {
  if (status === 400 || status === 422 || status === 502) return status;
  throw new Error(`Unsupported import error status ${status}`);
}

function importErrorResponse(
  status: ImportErrorStatus,
  body: ImportErrorPayload,
): Exclude<ImportRouteResponse<never>, { status: 200 }> {
  switch (status) {
    case 400:
      return { status, body };
    case 422:
      return { status, body };
    case 502:
      return { status, body };
  }
}

// `gpayHtmlPath` is the temp path of an already-staged Google Pay Takeout
// HTML upload, produced by the route handler rather than read from `body`.
export function optionsFromMultipartBody(
  body: Record<string, unknown>,
  gpayHtmlPath: string | null = null,
): ImportOptions {
  if (typeof body.base_account !== "string" || body.base_account.length === 0) {
    throw new MultipartFieldMissingError("base_account");
  }
  const mappingsStr = body.custom_mappings_filenames;
  const accountKind = body.is_credit_card === "true" ? "credit-card" : "bank";
  return {
    baseAccount: parseAccount(body.base_account),
    accountKind,
    balanceOverrides: {
      opening: toLedgerBalance(
        parseOptionalMoneyField(body, "manual_opening_balance"),
        accountKind === "credit-card",
      ),
      closing: toLedgerBalance(
        parseOptionalMoneyField(body, "manual_closing_balance"),
        accountKind === "credit-card",
      ),
    },
    customMappingsFilenames:
      typeof mappingsStr === "string" && mappingsStr !== ""
        ? mappingsStr.split(",").map((s: string) => s.trim())
        : [],
    gpayHtmlPath,
  };
}

export function argsFromMultipartBody(
  body: Record<string, unknown>,
  filePaths: string[],
  gpayHtmlPath: string | null = null,
): FreeformImportArgs {
  return {
    ...optionsFromMultipartBody(body, gpayHtmlPath),
    filePaths,
  };
}

export function jsonOptionsFromMultipartBody(
  body: Record<string, unknown>,
  gpayHtmlPath: string | null = null,
): ImportOptions {
  return optionsFromMultipartBody(body, gpayHtmlPath);
}

export function respondWithImportErrors<T>(
  run: () => Promise<T>,
): Promise<ImportRouteResponse<T>>;
export function respondWithImportErrors<T>(
  c: any,
  run: () => Promise<T>,
): Promise<Response>;
export async function respondWithImportErrors<T>(
  first: any,
  second?: () => Promise<T>,
) {
  const c = typeof first === "function" ? null : first;
  const run = (c === null ? first : second) as () => Promise<T>;
  try {
    const body = await run();
    return c === null ? { status: 200 as const, body } : c.json(body);
  } catch (err) {
    if (err instanceof ApiImportError) {
      const status = importErrorStatus(err.status);
      const body = importErrorPayload(err);
      return c === null
        ? importErrorResponse(status, body)
        : c.json(body, status as any);
    }
    throw err;
  }
}

export function respondFromFreeformImport(
  c: any,
  args: FreeformImportArgs,
  auth?: RowScopeAuth,
) {
  return respondWithImportErrors(c, () =>
    runFreeformImport(args, c.get("db"), auth),
  );
}
