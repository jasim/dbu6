// The chart-of-accounts module: the starter chart a new user begins from,
// the rules a proposed chart must keep before it is created, and the LLM
// call that draws one from the user's own words. Import from here rather
// than from the files.
export {
  normalizeChartProposal,
  validateChartProposal,
  type ChartValidation,
  type NormalizedChart,
} from "./chart.js";
export {
  chartWithAccounts,
  STARTER_CHART,
  STARTER_UNTICKED,
} from "./starter-chart.js";
export {
  chartRequest,
  CHART_PROMPT,
  type ChartLlm,
  type GetAnswer,
  type GetClient,
  type GetRequest,
} from "./suggest.js";
