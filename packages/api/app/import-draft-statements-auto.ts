import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { importDraftsContract } from "dbu6-shared";
import { filesFromField } from "./import-draft-journals-from-statement-files.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Automatic statement import: the user uploads files and nothing else.
//
// Planned composition, all of it existing code except the plan step:
//
//   withTempUploads(files)
//     -> per file: savedCustomStatementParserPaths(ext)
//                  autoDetectCustomStatementParsers(candidates, [path])
//     -> Detection[] (matched | unrecognized | ambiguous)
//     -> planImport(detections, presets)      pure: one account or a rejection
//     -> optionsFromMultipartBody(preset fields, gpayHtmlPath)
//     -> runAbacusJsonImport(jsonTexts, opts, db, auth)
//     -> { ...result, plan }
//
// Account resolution waits on the parsers emitting the statement's account or
// card number in their Abacus JSON, so this handler is a stub until then.

const api = new TsRestApi<SapportaEnv>();

api.register(
  "uploadStatementsAuto",
  importDraftsContract.uploadStatementsAuto,
  async ({ c, files: uploadedFiles }) => {
    requireWorkflowAuth(c);

    const files = filesFromField(uploadedFiles, "files");
    if (files.length === 0) {
      return {
        status: 400 as const,
        body: {
          error: "missing_multipart_field",
          message: "Missing 'files' field in multipart upload",
        },
      };
    }

    return {
      status: 501 as const,
      body: {
        error: "auto_import_not_implemented",
        message:
          "Automatic statement recognition is not available yet. The saved parsers do not report account numbers, so files cannot be tied to an account.",
        hint: "Use Import a statement (manual) and choose the account yourself.",
      },
    };
  },
);

export default api;
