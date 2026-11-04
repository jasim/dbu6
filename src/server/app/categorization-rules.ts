import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { categorizationRulesContract } from "../../shared/index.js";
import {
  MappingRuleError,
  oneRuleSchema,
} from "../modules/categorization/index.js";
import { previewCategorizationRule } from "../workflows/reclassification.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The categorization rules, tried before they are written. The coding agent
 * previews a rule with
 * `npx sapporta api post /api/categorization-rules/preview --body '{"rule":{…}}'`
 * before proposing it.
 */
const api = new TsRestApi<SapportaEnv>();

api.register(
  "previewCategorizationRule",
  categorizationRulesContract.previewCategorizationRule,
  async ({ c, request }) => {
    const ledger = requireWorkflowLedger(c);
    const rule = oneRuleSchema.safeParse(request.body.rule);
    if (!rule.success) {
      return {
        status: 422,
        body: {
          error: `Not a rule in the file's shape: ${rule.error.message}`,
        },
      };
    }
    try {
      return {
        status: 200,
        body: previewCategorizationRule(ledger, rule.data),
      };
    } catch (error) {
      // A rule that sends a statement's rows to that statement's own account.
      if (error instanceof MappingRuleError) {
        return { status: 422, body: { error: error.message } };
      }
      throw error;
    }
  },
);

export default api;
