import type { LlmStatus } from "../../../shared/index.js";

/** Who answers calls on `llm`, or why nobody can, as the screens say it. */
export function llmStatus(llm: {
  name: string;
  caller: { ready: true } | { ready: false; reason: string };
}): LlmStatus {
  return llm.caller.ready
    ? { ready: true, name: llm.name }
    : { ready: false, name: llm.name, reason: llm.caller.reason };
}
