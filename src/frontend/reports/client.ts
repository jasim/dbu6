import { reportsContract } from "../../shared/index";
import { reportClient } from "../report-kit";

/** The client for dbu6's own reports, made the way a project makes its own. */
export const reportsApi = reportClient(reportsContract);
