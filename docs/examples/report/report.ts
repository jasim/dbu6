import type { ReportDefinition } from "dbu6/frontend";
import { SpendingByWeekdayScreen } from "./Screen.tsx";

// The Reports page lists this under "Your reports" and the screen opens at
// /reports/<id>. The id must not be one dbu6 already uses.
const report: ReportDefinition = {
  id: "spending-by-weekday",
  label: "Spending by Weekday",
  description: "Which days of the week the money goes out on",
  Component: SpendingByWeekdayScreen,
};

export default report;
