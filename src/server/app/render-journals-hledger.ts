import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { journalsContract, reportsContract } from "../../shared/index.js";
import { renderVisibleJournalsAsHledger } from "../modules/journals/index.js";
import { readOnlyLedger } from "../modules/ledger-sql/index.js";
import {
  ledgerAccountIds,
  loadLedgerJournals,
} from "./reports/account-ledger.js";
import { authorizeReport } from "./reports/shared.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "renderHledger",
  journalsContract.renderHledger,
  ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const result = renderVisibleJournalsAsHledger({
      db: c.get("db"),
      auth,
      journalIds: request.body.journal_ids,
    });

    return {
      status: 200,
      body: result,
    };
  },
);

// The Account Ledger's journals, the ones its rows come from, picked as the
// report picks them (the account and those under it, in the period) and
// rendered whole, every line, oldest first, with balance assertions on those
// accounts' lines only. Whoever may read the report may read these.
api.register(
  "accountLedgerHledger",
  reportsContract.accountLedgerHledger,
  ({ c, request }) => {
    const auth = authorizeReport(c, "account-ledger");
    const ledger = readOnlyLedger(c.get("sqlite"), auth);
    const accountIds = ledgerAccountIds(ledger, request.query.account_id);
    const journals = loadLedgerJournals(ledger, {
      accountIds,
      fromDate: request.query.from_date ?? null,
      toDate: request.query.to_date ?? null,
    });

    return {
      status: 200,
      body: renderVisibleJournalsAsHledger({
        db: c.get("db"),
        auth,
        journalIds: journals.map((journal) => journal.journal_id),
        assertionAccountIds: accountIds,
      }),
    };
  },
);

export default api;
