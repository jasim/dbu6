import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  setupContract,
  type ChartAccount,
  type ChartRefusal,
} from "../../shared/index.js";
import { chartLlm, llmStatus } from "../modules/coding-agent/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  createChart,
  loadChartOfAccounts,
  suggestChart,
} from "../workflows/chart-of-accounts.js";
import {
  changeStatementAccount,
  loadStatementAccounts,
} from "../workflows/import-presets.js";
import { requireOwner, requireWorkflowLedger } from "./workflow-auth.js";

/*
 * Setting up the books (/setup), the owner's only: the chart of accounts,
 * and the banks and cards statements come from, which /add and agents set
 * up and Settings › Banks & cards changes. Nothing here keeps state: each
 * reply is read from the books.
 */

export default function setupApi(): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();

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

  api.register(
    "chartSuggester",
    setupContract.chartSuggester,
    async ({ c }) => {
      requireOwner(c);
      return { status: 200, body: llmStatus(await chartLlm()) };
    },
  );

  // One headless call, up to the agent's time limit (nuabase.ts).
  api.register(
    "suggestChartOfAccounts",
    setupContract.suggestChartOfAccounts,
    async ({ c, request }) => {
      requireOwner(c);
      const { description, current } = request.body;
      const outcome = await suggestChart(
        await chartLlm(),
        description,
        current,
      );
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

  api.register(
    "statementAccounts",
    setupContract.statementAccounts,
    async ({ c }) => ({
      status: 200,
      body: loadStatementAccounts(requireWorkflowLedger(c)),
    }),
  );

  api.register(
    "changeStatementAccount",
    setupContract.changeStatementAccount,
    async ({ c, request }) => {
      const outcome = await changeStatementAccount(
        requireWorkflowLedger(c),
        request.body,
      );
      if (outcome.ok) return { status: 200, body: outcome.accounts };
      return {
        status: 422,
        body: { error: outcome.problem.message, code: outcome.problem.code },
      };
    },
  );

  return api;
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
