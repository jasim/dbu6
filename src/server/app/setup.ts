import { basename } from "node:path";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  setupContract,
  type FirstStatementRefusal,
  type ChartAccount,
  type ChartRefusal,
  type SetupStatus,
} from "../../shared/index.js";
import { loadAccountChart } from "../modules/accounts/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { chartLlm } from "../modules/coding-agent/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
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
import {
  hasTransactions,
  importFirstStatement,
  loadFirstStatements,
  loadStatementActivity,
  recognizeSample,
  type SampleOutcome,
} from "../workflows/first-statement.js";
import { batchResponse } from "./import-draft-statements-auto.js";
import {
  removeStagedSample,
  stagedSamples,
  stageSample,
  uploadedFile,
  type StagedSample,
} from "./upload-tmp.js";
import { requireOwner, requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The account setup wizard's routes (/setup), the owner's only. The wizard
 * keeps no state: each step reads where it stands from the books.
 */

export default function setupApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
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

  api.register(
    "chartSuggester",
    setupContract.chartSuggester,
    async ({ c }) => {
      requireOwner(c);
      const llm = await chartLlm();
      return {
        status: 200,
        body: llm.caller.ready
          ? { ready: true as const, name: llm.name }
          : {
              ready: false as const,
              name: llm.name,
              reason: llm.caller.reason,
            },
      };
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

  // A staged statement is kept until it is imported: an account that has
  // transactions, or that no preset lists any more, loses it here.
  api.register(
    "firstStatements",
    setupContract.firstStatements,
    async ({ c }) => {
      const ledger = requireWorkflowLedger(c);
      const staged = await stagedSamples();
      const body = await loadFirstStatements(ledger, staged);
      const waiting = new Set(
        body.accounts
          .filter((row) => row.status === "read" || row.status === "unreadable")
          .map((row) => row.account_id),
      );
      for (const accountId of staged.keys()) {
        if (!waiting.has(accountId)) await removeStagedSample(accountId);
      }
      return { status: 200, body };
    },
  );

  // The upload replaces the account's staged statement, read or not.
  api.register(
    "uploadSampleStatement",
    setupContract.uploadSampleStatement,
    async ({ c, request, files }) => {
      const ledger = requireWorkflowLedger(c);
      const file = uploadedFile(files, "file");
      if (file === null) {
        return {
          status: 400,
          body: {
            error: "Upload the statement as `file`.",
            code: "missing_multipart_field" as const,
          },
        };
      }
      const { account_id } = request.body;
      const staged = await stageSample(account_id, file);
      const outcome = await recognizeSample(ledger, account_id, staged.path);
      if (!outcome.ok) await removeStagedSample(account_id);
      return sampleResponse(outcome, staged);
    },
  );

  // One headless import, categorization included, as long as /import's.
  api.register(
    "importFirstStatement",
    setupContract.importFirstStatement,
    async ({ c, request }) => {
      const ledger = requireWorkflowLedger(c);
      const { account_id, opening_amount, use_statement_number } = request.body;
      const staged = (await stagedSamples()).get(account_id);
      if (staged === undefined) {
        return {
          status: 404,
          body: {
            error:
              "There is no statement waiting for this account; upload one.",
            code: "no_staged_statement" as const,
          },
        };
      }
      const done = await importFirstStatement(ledger, loadCategorizer, {
        accountId: account_id,
        statement: { name: basename(staged.path), path: staged.path },
        openingAmount: opening_amount ?? null,
        useStatementNumber: use_statement_number ?? false,
      });
      if (!done.ok) return firstStatementRefusal(done.refusal);
      // The staged copy is what "Try again" imports, so it goes only once the
      // statement is in.
      const imported = done.outcome.kind === "imported";
      if (imported) await removeStagedSample(account_id);
      return batchResponse(done.outcome, () =>
        imported ? null : staged.projectPath,
      );
    },
  );

  api.register(
    "recheckSampleStatement",
    setupContract.recheckSampleStatement,
    async ({ c, request }) => {
      const ledger = requireWorkflowLedger(c);
      const { account_id } = request.body;
      const staged = (await stagedSamples()).get(account_id);
      if (staged === undefined) {
        return {
          status: 404,
          body: {
            error:
              "There is no statement waiting for this account; upload one.",
            code: "no_staged_sample" as const,
          },
        };
      }
      return sampleResponse(
        await recognizeSample(ledger, account_id, staged.path),
        staged,
      );
    },
  );

  api.register(
    "removeSampleStatement",
    setupContract.removeSampleStatement,
    async ({ c, request }) => {
      requireOwner(c);
      return {
        status: 200,
        body: { removed: await removeStagedSample(request.params.accountId) },
      };
    },
  );

  return api;
}

// A missing account or file isn't there, a state the step must leave first
// conflicts, and the rest is what the request brought.
function firstStatementRefusal(refusal: FirstStatementRefusal) {
  switch (refusal.code) {
    case "unknown_account":
    case "no_staged_statement":
      return { status: 404 as const, body: refusal };
    case "already_imported":
    case "statement_unreadable":
    case "numbers_differ":
      return { status: 409 as const, body: refusal };
    default:
      return { status: 422 as const, body: refusal };
  }
}

function sampleResponse(outcome: SampleOutcome, staged: StagedSample) {
  if (!outcome.ok) {
    return {
      status: 404 as const,
      body: {
        error: "That bank or card isn't set up any more.",
        code: outcome.code,
      },
    };
  }
  const { finding } = outcome;
  return {
    status: 200 as const,
    body:
      finding.outcome === "recognized"
        ? finding
        : { ...finding, saved_path: staged.projectPath },
  };
}

/**
 * Where the wizard stands: the chart's size, and each bank or card's
 * transactions counted as the first statements step counts them.
 */
export function loadSetupStatus(ledger: Ledger): SetupStatus {
  const activity = loadStatementActivity(ledger);
  const banks = loadImportPresets(ledger.db, ledger.auth).flatMap(
    (institution) =>
      institution.accounts.map((account) => activity(account.account_id)),
  );
  return {
    accounts: loadAccountChart(ledger.db, ledger.auth).length,
    statement_accounts: banks.length,
    imported_accounts: banks.filter(hasTransactions).length,
    drafts: banks.reduce((total, bank) => total + bank.drafts, 0),
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
