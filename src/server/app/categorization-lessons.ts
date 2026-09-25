import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { categorizationLessonsContract } from "../../shared/index.js";
import { loadCategorizationLessons } from "../modules/drafts/index.js";
import {
  forgetCategorizationLesson,
  forgetCategorizationLessons,
  teachCategorization,
} from "../workflows/reclassification.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * Lessons for the categoriser, from Review's Improve categorization tab. The
 * user's coding agent deletes each once it has encoded it, with
 * `sapporta api delete /api/categorization-lessons/<id>`.
 */
const api = new TsRestApi<SapportaEnv>();

api.register(
  "listCategorizationLessons",
  categorizationLessonsContract.listCategorizationLessons,
  async ({ c, request }) => {
    const { db, auth } = requireWorkflowLedger(c);
    return {
      status: 200,
      body: {
        lessons: loadCategorizationLessons(
          db,
          auth,
          request.query.base_account_id,
        ),
      },
    };
  },
);

api.register(
  "teachCategorization",
  categorizationLessonsContract.teachCategorization,
  async ({ c, request }) => {
    const { draft_ids, account_id, note } = request.body;
    const outcome = teachCategorization(requireWorkflowLedger(c), {
      draftIds: draft_ids,
      accountId: account_id,
      note,
    });
    switch (outcome.kind) {
      case "taught":
        return { status: 200, body: { lesson: outcome.lesson } };
      case "account-not-found":
        return { status: 404, body: { error: "Account not found" } };
      case "drafts-not-found":
        return {
          status: 404,
          body: { error: `Drafts not found: ${outcome.ids.join(", ")}` },
        };
      case "own-account":
        return {
          status: 422,
          body: {
            error:
              "A draft's category can't be the account its statement belongs to",
          },
        };
      case "not-one-account":
        return {
          status: 422,
          body: {
            error: "A lesson's drafts must all come from one bank or card",
          },
        };
    }
  },
);

api.register(
  "deleteCategorizationLesson",
  categorizationLessonsContract.deleteCategorizationLesson,
  async ({ c, request }) => {
    const deleted = forgetCategorizationLesson(
      requireWorkflowLedger(c),
      request.params.id,
    );
    return deleted === 0
      ? { status: 404, body: { error: "Lesson not found" } }
      : { status: 200, body: { deleted } };
  },
);

api.register(
  "clearCategorizationLessons",
  categorizationLessonsContract.clearCategorizationLessons,
  async ({ c, request }) => ({
    status: 200,
    body: {
      deleted: forgetCategorizationLessons(
        requireWorkflowLedger(c),
        request.query.base_account_id,
      ),
    },
  }),
);

export default api;
