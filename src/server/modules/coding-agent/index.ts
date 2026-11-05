// The coding-agent module: detecting the agents, their models, handing a
// prompt to one and its access to the app (`.env.agent`), the Settings
// screen's reads and changes, and at its top the engines categorization and
// setup's chart of accounts run on.
// Import from here rather than from the files.
export { categorizationLlm } from "./categorization-llm.js";
export { chartLlm } from "./chart-llm.js";
export { llmStatus } from "./llm-status.js";
export {
  CodingAgentError,
  NoCodingAgentError,
  TerminalOpenFailedError,
} from "./errors.js";
export {
  agentHandoffAvailability,
  handOffPrompt,
  type AgentTokenFor,
} from "./handoff.js";
export {
  agentLedger,
  mintAgentToken,
  workingAgentToken,
  writeAgentToken,
  type AgentTokenMinter,
  type AgentTokenOwner,
} from "./agent-access.js";
export { chosenCodingAgent } from "./agents.js";
export { startCodingAgent } from "./models.js";
export { agentSetupGuide } from "./nuabase.js";
export {
  chooseCodingAgent,
  codingAgentSettings,
  recheckCodingAgentModels,
} from "./settings.js";
