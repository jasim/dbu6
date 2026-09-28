import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { categorizationRuleRequestsContract } from "../../shared/index.js";
import { loadCategorizationRuleRequests } from "../modules/drafts/index.js";
import {
  forgetCategorizationRuleRequest,
  forgetCategorizationRuleRequests,
  requestCategorizationRule,
} from "../workflows/reclassification.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * Rule requests for the categoriser, from Review's Improve categorization
 * tab. The user's coding agent deletes each once it has encoded it, with
 * `npx sapporta api delete /api/categorization-rule-requests/<id>`.
 */
const api = new TsRestApi<SapportaEnv>();

api.register(
  "listCategorizationRuleRequests",
  categorizationRuleRequestsContract.listCategorizationRuleRequests,
  async ({ c, request }) => {
    const { db, auth } = requireWorkflowLedger(c);
    return {
      status: 200,
      body: {
        rule_requests: loadCategorizationRuleRequests(
          db,
          auth,
          request.query.base_account_id,
        ),
      },
    };
  },
);

api.register(
  "requestCategorizationRule",
  categorizationRuleRequestsContract.requestCategorizationRule,
  async ({ c, request }) => {
    const { draft_ids, account_id, note } = request.body;
    const outcome = requestCategorizationRule(requireWorkflowLedger(c), {
      draftIds: draft_ids,
      accountId: account_id,
      note,
    });
    switch (outcome.kind) {
      case "requested":
        return { status: 200, body: { rule_request: outcome.ruleRequest } };
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
            error: "A draft can't go to the account its statement belongs to",
          },
        };
      case "not-one-account":
        return {
          status: 422,
          body: {
            error:
              "A rule request's drafts must all come from one bank or card",
          },
        };
    }
  },
);

api.register(
  "deleteCategorizationRuleRequest",
  categorizationRuleRequestsContract.deleteCategorizationRuleRequest,
  async ({ c, request }) => {
    const deleted = forgetCategorizationRuleRequest(
      requireWorkflowLedger(c),
      request.params.id,
    );
    return deleted === 0
      ? { status: 404, body: { error: "Rule request not found" } }
      : { status: 200, body: { deleted } };
  },
);

api.register(
  "clearCategorizationRuleRequests",
  categorizationRuleRequestsContract.clearCategorizationRuleRequests,
  async ({ c, request }) => ({
    status: 200,
    body: {
      deleted: forgetCategorizationRuleRequests(
        requireWorkflowLedger(c),
        request.query.base_account_id,
      ),
    },
  }),
);

export default api;
