import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  setupContract,
  statementFormatReady,
  type ChartAccount,
  type ChartRefusal,
  type SetupStatus,
} from "../../shared/index.js";
import { loadAccountChart } from "../modules/accounts/index.js";
import { chartLlm } from "../modules/coding-agent/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  createChart,
  loadChartOfAccounts,
  suggestChart,
} from "../workflows/chart-of-accounts.js";
import { requireOwner, requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The account setup wizard's routes (/setup), the owner's only. The wizard
 * keeps no state: each step reads where it stands from the books.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("setupStatus", setupContract.setupStatus, async ({ c }) => ({
  status: 200,
  body: loadSetupStatus(requireWorkflowLedger(c)),
}));

api.register(
  "chartOfAccounts",
  setupContract.chartOfAccounts,
  async ({ c }) => ({
    status: 200,
    body: loadChartOfAccounts(requireWorkflowLedger(c)),
  }),
);

api.register(
  "createChartOfAccounts",
  setupContract.createChartOfAccounts,
  async ({ c, request }) =>
    createChartResponse(requireWorkflowLedger(c), request.body.accounts),
);

api.register("chartSuggester", setupContract.chartSuggester, async ({ c }) => {
  requireOwner(c);
  const llm = await chartLlm();
  return {
    status: 200,
    body: llm.caller.ready
      ? { ready: true as const, name: llm.name }
      : { ready: false as const, name: llm.name, reason: llm.caller.reason },
  };
});

// One headless call, up to the agent's time limit (nuabase.ts).
api.register(
  "suggestChartOfAccounts",
  setupContract.suggestChartOfAccounts,
  async ({ c, request }) => {
    requireOwner(c);
    const { description, current } = request.body;
    const outcome = await suggestChart(await chartLlm(), description, current);
    if (outcome.ok) {
      return {
        status: 200,
        body: { proposal: outcome.proposal, notes: outcome.notes },
      };
    }
    const body = { error: outcome.error, code: outcome.code };
    return outcome.code === "llm_unavailable"
      ? { status: 503, body }
      : { status: 502, body };
  },
);

export default api;

export function loadSetupStatus(ledger: Ledger): SetupStatus {
  const institutions = loadImportPresets(ledger.db, ledger.auth);
  const presetAccounts = institutions.flatMap((institution) =>
    institution.accounts.map((account) => ({ institution, account })),
  );
  return {
    accounts: loadAccountChart(ledger.db, ledger.auth).length,
    preset_accounts: presetAccounts.length,
    ready_accounts: presetAccounts.filter(({ institution, account }) =>
      statementFormatReady(institution, account),
    ).length,
  };
}

export function createChartResponse(
  ledger: Ledger,
  accounts: readonly ChartAccount[],
):
  | { status: 201; body: { created: number } }
  | { status: 409; body: ChartRefusal }
  | { status: 422; body: ChartRefusal } {
  const outcome = createChart(ledger, accounts);
  if (outcome.ok) return { status: 201, body: { created: outcome.created } };
  if (outcome.code === "books_have_accounts") {
    return {
      status: 409,
      body: {
        error: outcome.problems.join(" "),
        code: outcome.code,
        problems: outcome.problems,
      },
    };
  }
  return {
    status: 422,
    body: {
      error: `The chart can't be created: ${outcome.problems.join(" ")}`,
      code: outcome.code,
      problems: outcome.problems,
    },
  };
}
