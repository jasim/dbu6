import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { accountsContract } from "../../shared/index.js";
import {
  changeAccount,
  deleteChartAccount,
} from "../workflows/chart-of-accounts.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * One account's name, type and parent, changed together, and an empty
 * account deleted. The Accounts page's edit form is the only caller in the
 * app; coding agents use `sapporta api put/delete /api/accounts/<id>`, which
 * is why the rules live in the workflow rather than in the form.
 *
 * Creating an account stays on the generated table API
 * (`POST /api/tables/accounts`): one INSERT already writes its type and
 * parent together, so nothing needs a transaction to sequence it.
 */

const api = new TsRestApi<SapportaEnv>();

api.register(
  "changeAccount",
  accountsContract.changeAccount,
  async ({ c, request }) => {
    const outcome = changeAccount(
      requireWorkflowLedger(c),
      request.params.id,
      request.body,
    );
    if (!outcome.ok) {
      return {
        status: 422,
        body: {
          error: outcome.problem.message,
          code: outcome.problem.code,
          field: outcome.problem.field,
        },
      };
    }
    return {
      status: 200,
      body: { account: outcome.account, moved: outcome.moved },
    };
  },
);

api.register(
  "deleteAccount",
  accountsContract.deleteAccount,
  async ({ c, request }) => {
    const outcome = deleteChartAccount(
      requireWorkflowLedger(c),
      request.params.id,
    );
    if (!outcome.ok) {
      return {
        status: 422,
        body: {
          error: outcome.problem.message,
          code: outcome.problem.code,
        },
      };
    }
    return { status: 204, body: undefined };
  },
);

export default api;
