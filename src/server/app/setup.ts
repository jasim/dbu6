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
import {
  changeStatementAccount,
  loadStatementAccounts,
} from "../workflows/import-presets.js";
import {
  loadStatementFormats,
  recognizeSample,
  type SampleOutcome,
} from "../workflows/sample-statements.js";
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

// A sample is kept only while it waits for a parser: an account that is
// ready, or that no preset lists any more, loses it here.
api.register(
  "statementFormats",
  setupContract.statementFormats,
  async ({ c }) => {
    const ledger = requireWorkflowLedger(c);
    const staged = await stagedSamples();
    const rows = loadStatementFormats(
      ledger,
      new Map([...staged].map(([id, sample]) => [id, sample.projectPath])),
    );
    const waiting = new Set(
      rows
        .filter((row) => row.status === "waiting_for_parser")
        .map((row) => row.account_id),
    );
    for (const accountId of staged.keys()) {
      if (!waiting.has(accountId)) await removeStagedSample(accountId);
    }
    return {
      status: 200,
      body: {
        accounts: rows.map((row) =>
          waiting.has(row.account_id) ? row : { ...row, staged_sample: null },
        ),
      },
    };
  },
);

// The upload is staged in the project either way; a sample the parsers
// recognized isn't kept.
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
          error: "Upload the sample statement as `file`.",
          code: "missing_multipart_field" as const,
        },
      };
    }
    const { account_id } = request.body;
    const staged = await stageSample(account_id, file);
    const outcome = await recognizeSample(ledger, account_id, staged.path);
    if (!outcome.ok || outcome.finding.outcome === "recognized") {
      await removeStagedSample(account_id);
    }
    return sampleResponse(outcome, staged);
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
            "There is no sample statement waiting for this account; upload one.",
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

export default api;

function sampleResponse(outcome: SampleOutcome, staged: StagedSample) {
  if (!outcome.ok) {
    return {
      status: 404 as const,
      body: {
        error: "No bank or card has that account id.",
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
