import {
  CODING_AGENTS,
  NO_CODING_AGENT_MESSAGE,
  noAgentModelMessage,
  type CodingAgent,
  type UnavailableAgentModel,
} from "../../../shared/index.js";

/*
 * Why the server can't do what was asked with the machine's coding agent.
 * Each error carries the status and the body its routes return as they are
 * (app/coding-agent.ts, app/agent-handoff.ts, through
 * respondWithCodingAgentErrors); nothing else re-derives the message.
 */

export abstract class CodingAgentError extends Error {
  abstract readonly status: 400 | 500;
  abstract readonly error: string;

  toPayload(): { error: string; message: string } {
    return { error: this.error, message: this.message };
  }
}

export class NoCodingAgentError extends CodingAgentError {
  readonly status = 400;
  readonly error = "no_coding_agent";

  constructor() {
    super(NO_CODING_AGENT_MESSAGE);
    this.name = "NoCodingAgentError";
  }
}

export class CodingAgentNotInstalledError extends CodingAgentError {
  readonly status = 400;
  readonly error = "agent_not_installed";

  constructor(agent: CodingAgent) {
    super(
      `${CODING_AGENTS[agent].label} isn't installed on the machine running dbu6.`,
    );
    this.name = "CodingAgentNotInstalledError";
  }
}

/**
 * Why an agent none of whose models answered can't be used, in the server's
 * words: the sentence Settings also shows, the floor model's own reason, and
 * where to look. Categorization reports it instead of throwing it, so it is a
 * function of its own as well.
 */
export function noAgentModelReason(
  agent: CodingAgent,
  unavailable: readonly UnavailableAgentModel[],
): string {
  const floor = unavailable[unavailable.length - 1];
  const said =
    floor === undefined ? "" : ` ${floor.label} said: ${floor.reason}.`;
  return `${noAgentModelMessage(agent, unavailable)}${said} See Settings.`;
}

export class NoAgentModelError extends CodingAgentError {
  readonly status = 400;
  readonly error = "no_agent_model";

  constructor(
    agent: CodingAgent,
    unavailable: readonly UnavailableAgentModel[],
  ) {
    super(noAgentModelReason(agent, unavailable));
    this.name = "NoAgentModelError";
  }
}

export class HandoffUnsupportedError extends CodingAgentError {
  readonly status = 400;
  readonly error = "agent_handoff_unsupported";

  constructor(agent: CodingAgent) {
    super(
      `dbu6 can't start ${CODING_AGENTS[agent].label} on this operating system. Copy the prompt instead.`,
    );
    this.name = "HandoffUnsupportedError";
  }
}

export class PromptTooLongError extends CodingAgentError {
  readonly status = 400;
  readonly error = "prompt_too_long";

  constructor(agent: CodingAgent) {
    super(
      `This prompt is too long to start ${CODING_AGENTS[agent].label} with on this system. Copy it instead.`,
    );
    this.name = "PromptTooLongError";
  }
}

export class TerminalOpenFailedError extends CodingAgentError {
  readonly status = 500;
  readonly error = "terminal_open_failed";

  constructor(reason: string, command: string) {
    super(
      `Couldn't open a terminal window (${reason}). Run this in a terminal instead: ${command}`,
    );
    this.name = "TerminalOpenFailedError";
  }
}
