import {
  type ReportLedger,
  reportLedger,
  type SapportaEnv,
  TsRestApi,
} from "../../report-kit.js";
import { reportsContract, type BooksSpan } from "../../../shared/index.js";

/*
 * The days the books cover, from the first posted journal to the last: what
 * a report's period menu offers months from, and what "All time" spans on a
 * screen that needs its dates.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("booksSpan", reportsContract.booksSpan, ({ c }) => ({
  status: 200,
  body: booksSpan(reportLedger(c, "books-span")),
}));

export default api;

export function booksSpan(ledger: ReportLedger): BooksSpan {
  const [row] = ledger.all<{
    first_date: string | null;
    last_date: string | null;
  }>(
    `SELECT MIN(date) AS first_date, MAX(date) AS last_date
     FROM scoped_journals`,
  );
  return {
    span:
      row?.first_date && row.last_date
        ? { first_date: row.first_date, last_date: row.last_date }
        : null,
  };
}
