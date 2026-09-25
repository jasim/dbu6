// The chart-of-accounts module: the starter chart a new user begins from,
// and the rules a proposed chart must keep before it is created. Import
// from here rather than from the files.
export { validateChartProposal, type ChartValidation } from "./chart.js";
export {
  chartWithAccounts,
  STARTER_CHART,
  STARTER_UNTICKED,
} from "./starter-chart.js";
