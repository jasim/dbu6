import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { categorizationRulesContract } from "../../shared/index.js";
import { MappingRuleError } from "../modules/categorization/index.js";
import { previewCategorizationRule } from "../workflows/reclassification.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The categorization rules, tried before they are written. The coding agent
 * previews a rule with
 * `npx sapporta api post /api/categorization-rules/preview --body '{"rule":{…}}'`
 * before proposing it. The contract parses the rule in the file's shape.
 */
const api = new TsRestApi<SapportaEnv>();

api.register(
  "previewCategorizationRule",
  categorizationRulesContract.previewCategorizationRule,
  async ({ c, request }) => {
    const ledger = requireWorkflowLedger(c);
    try {
      return {
        status: 200,
        body: previewCategorizationRule(ledger, request.body.rule),
      };
    } catch (error) {
      // A rule the file would refuse (`compileMappings`).
      if (error instanceof MappingRuleError) {
        return { status: 422, body: { error: error.message } };
      }
      throw error;
    }
  },
);

export default api;
