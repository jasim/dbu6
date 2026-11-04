import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  importDraftsContract,
  type AbacusImportRequest,
  type AbacusImportResult,
  type StatementImportError,
} from "../../shared/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { importFreeformStatement } from "../workflows/statement-import/index.js";
import { respondWithImportErrors } from "./import-error-response.js";
import { inboxFilesFromField, deleteInboxFiles } from "./statement-inbox.js";
import { requireWorkflowLedger } from "./workflow-auth.js";
import { writeCommentsSoon } from "../workflows/comment-writer.js";

// Import of one Abacus statement posted as JSON by a coding agent, for
// freeform transactions (custom-built-parsers/freeform-transactions-guide.md).
// The workflow checks the account and the statement's balances, then imports.
//
// Everything the import needs is in the request, so no import preset is
// involved. The response is raw data for the agent to explain: the
// per-account result the automatic import reports, or the import error's own
// payload.
//
// The server never reads the file the rows came from, so the agent names it
// in `inbox_files`, and the import deletes it from the statement inbox once
// the rows are in the drafts, as every import deletes its own files.

type AbacusImportRouteResponse =
  | { status: 200; body: AbacusImportResult }
  | { status: 400; body: StatementImportError }
  | { status: 422; body: StatementImportError };

const DEFAULT_SOURCE_NAME = "freeform transactions";

export async function importAbacusStatement(
  request: AbacusImportRequest,
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
): Promise<AbacusImportRouteResponse> {
  const { base_account, is_credit_card, statement } = request;
  const sourceName = request.source_name ?? DEFAULT_SOURCE_NAME;
  const response = await respondWithImportErrors(() =>
    importFreeformStatement(
      {
        baseAccount: base_account,
        accountKind: accountKindOf(is_credit_card),
        statement,
        sourceName,
      },
      ledger,
      loadCategorizer,
    ),
  );
  // The new drafts' comments, in the background.
  writeCommentsSoon();
  if (response.status !== 200) return response;
  return {
    status: 200,
    body: {
      base_account,
      is_credit_card,
      file_names: [sourceName],
      result: response.body,
    },
  };
}

export default function importDraftAbacusApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();
  api.register(
    "importAbacusStatement",
    importDraftsContract.importAbacusStatement,
    async ({ c, request }) => {
      const ledger = requireWorkflowLedger(c);
      const inbox = await inboxFilesFromField(request.body);
      if ("notInInbox" in inbox) {
        return {
          status: 400 as const,
          body: { error: "not_in_inbox" as const, message: inbox.notInInbox },
        };
      }
      const response = await importAbacusStatement(
        request.body,
        ledger,
        loadCategorizer,
      );
      if (response.status !== 200 || inbox.files.length === 0) return response;
      return {
        status: 200 as const,
        body: {
          ...response.body,
          inbox_files_imported: await deleteInboxFiles(inbox.files),
        },
      };
    },
  );
  return api;
}
