import { describe, expect, it } from "vitest";
import {
  AGENT_ENV_FILE,
  AGENT_TOKEN_NAME,
  AgentEnvError,
  agentEnvExports,
  agentEnvFile,
  chooseAgentAccount,
  VERIFY_COMMAND,
  type AgentAccount,
} from "./agent-env.js";

const OWNER: AgentAccount = {
  userId: "05050500-owner",
  email: "owner@example.com",
  name: "NOPII OWNER",
  organizationId: "05050500-org",
  organizationName: "NOPII OWNER's Workspace",
};

const DEMO: AgentAccount = {
  userId: "05050500-demo",
  email: "demo@example.com",
  name: "Demo User",
  organizationId: "05050500-demo-org",
  organizationName: "Demo's Workspace",
};

const VALUES = {
  apiUrl: "http://localhost:2345",
  apiToken: "spat_05050500_050505",
};

describe("agentEnvFile", () => {
  it("writes the two values the Sapporta CLI reads, and where they came from", () => {
    const file = agentEnvFile({ ...VALUES, createdFor: OWNER.email });

    expect(file).toContain("SAPPORTA_API_URL=http://localhost:2345");
    expect(file).toContain(`SAPPORTA_API_TOKEN=${VALUES.apiToken}`);
    // The person who owns the token, so the file can be judged later.
    expect(file).toContain(OWNER.email);
    // Gitignored, and read by the shipped command only.
    expect(file).toContain("Gitignored");
    expect(file.endsWith("\n")).toBe(true);
  });
});

describe("agentEnvExports", () => {
  it("prints export lines a shell can eval", () => {
    expect(agentEnvExports(VALUES)).toBe(
      "export SAPPORTA_API_URL=http://localhost:2345\n" +
        `export SAPPORTA_API_TOKEN=${VALUES.apiToken}\n`,
    );
  });

  it("quotes a value a shell would otherwise split or expand", () => {
    expect(
      agentEnvExports({ ...VALUES, apiUrl: "http://localhost:2345/a b" }),
    ).toContain("export SAPPORTA_API_URL='http://localhost:2345/a b'");
  });
});

describe("the command agents are told to verify with", () => {
  it("reads the auth context, through the project's own sapporta bin", () => {
    expect(VERIFY_COMMAND).toBe("npx sapporta api get /api/auth-context");
  });
});

describe("chooseAgentAccount", () => {
  it("takes the one account, with no question asked", () => {
    expect(chooseAgentAccount([OWNER], { demos: [DEMO.email] })).toEqual(OWNER);
  });

  it("never hands the agent a sample account, even when it is the only one", () => {
    expect(() => chooseAgentAccount([DEMO], { demos: [DEMO.email] })).toThrow(
      AgentEnvError,
    );
    expect(() => chooseAgentAccount([DEMO], { demos: [DEMO.email] })).toThrow(
      /only sample accounts/,
    );
  });

  it("ignores a sample account when the owner is there beside it", () => {
    expect(chooseAgentAccount([DEMO, OWNER], { demos: [DEMO.email] })).toEqual(
      OWNER,
    );
  });

  it("asks which account when two are real, naming both emails", () => {
    const second = {
      ...OWNER,
      userId: "05050500-two",
      email: "two@example.com",
    };

    expect(() =>
      chooseAgentAccount([OWNER, second], { demos: [DEMO.email] }),
    ).toThrow(/--user <email>/);
    try {
      chooseAgentAccount([OWNER, second], { demos: [DEMO.email] });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(OWNER.email);
      expect(message).toContain(second.email);
    }
  });

  it("picks by email when --user names one", () => {
    const second = {
      ...OWNER,
      userId: "05050500-two",
      email: "two@example.com",
    };

    expect(
      chooseAgentAccount([OWNER, second], { user: "two@example.com" }),
    ).toEqual(second);
  });

  it("refuses a sample account even when --user names it", () => {
    expect(() =>
      chooseAgentAccount([DEMO, OWNER], {
        demos: [DEMO.email],
        user: DEMO.email,
      }),
    ).toThrow(/sample account/);
  });

  it("asks which workspace when one email is in two, and takes the user id", () => {
    const other = {
      ...OWNER,
      userId: "05050500-other-org",
      organizationId: "05050500-org-2",
      organizationName: "NOPII OWNER's Other Workspace",
    };

    expect(() =>
      chooseAgentAccount([OWNER, other], { user: OWNER.email }),
    ).toThrow(/more than one workspace/);
    try {
      chooseAgentAccount([OWNER, other], { user: OWNER.email });
    } catch (error) {
      const message = (error as Error).message;
      // Both workspaces named, each with the user id that chooses it.
      expect(message).toContain("NOPII OWNER's Workspace");
      expect(message).toContain("NOPII OWNER's Other Workspace");
      expect(message).toContain(OWNER.userId);
      expect(message).toContain(other.userId);
    }

    expect(chooseAgentAccount([OWNER, other], { user: other.userId })).toEqual(
      other,
    );
  });

  it("offers the user id when the project's accounts share an email", () => {
    const other = {
      ...OWNER,
      userId: "05050500-other-org",
      organizationId: "05050500-org-2",
      organizationName: "NOPII OWNER's Other Workspace",
    };

    expect(() => chooseAgentAccount([OWNER, other])).toThrow(/user id/);
  });

  it("says who is here when --user names nobody", () => {
    expect(() =>
      chooseAgentAccount([OWNER], { user: "nobody@example.com" }),
    ).toThrow(/owner@example\.com/);
  });

  it("tells a project with no account to sign up first", () => {
    expect(() => chooseAgentAccount([])).toThrow(/sign up/i);
  });
});

describe("the names this command owns", () => {
  it("marks the file and the token it writes, so both are recognisable", () => {
    expect(AGENT_ENV_FILE).toBe(".env.agent");
    expect(AGENT_TOKEN_NAME).toBe("dbu6 agent env");
  });
});
