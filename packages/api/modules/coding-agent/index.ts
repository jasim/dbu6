// The coding-agent module: detecting the agents, their models, handing a
// prompt to one, the Settings screen's reads and changes, and at its top the
// engine categorization runs on. Import from here rather than from the files.
export {
  categorizationLlm,
  llmEngineSetting,
} from "./categorization-llm.js";
export {
  CodingAgentError,
  NoCodingAgentError,
  TerminalOpenFailedError,
} from "./errors.js";
export { agentHandoffAvailability, handOffPrompt } from "./handoff.js";
export { startCodingAgent } from "./models.js";
export {
  chooseCodingAgent,
  codingAgentSettings,
  recheckCodingAgentModels,
} from "./settings.js";
