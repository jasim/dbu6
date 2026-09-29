import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ENV_FILE } from "./agent-env.js";
import {
  agentEnvPath,
  readAgentEnvValues,
  writeAgentEnvFile,
} from "./agent-file.js";

const roots: string[] = [];

function tempFile(name = ".env.agent"): string {
  const root = mkdtempSync(join(tmpdir(), "agent-file-"));
  roots.push(root);
  return join(root, name);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const VALUES = { apiToken: "spat_05050500_050505" };

describe("writeAgentEnvFile", () => {
  it("writes a new file private to its owner", () => {
    const file = tempFile();

    writeAgentEnvFile(file, "SAPPORTA_API_TOKEN=spat_05050500_050505\n");

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("makes a file that already existed private too", () => {
    const file = tempFile();
    // A restored backup, or a file some other tool made.
    writeFileSync(file, "old\n", { mode: 0o644 });

    writeAgentEnvFile(file, "SAPPORTA_API_TOKEN=spat_05050500_050505\n");

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("readAgentEnvValues", () => {
  it("reads the token a project holds", () => {
    const file = tempFile();
    writeAgentEnvFile(
      file,
      `# comment\nSAPPORTA_API_TOKEN=${VALUES.apiToken}\n`,
    );

    expect(readAgentEnvValues(file)).toEqual(VALUES);
  });

  it("reads an older file that still holds a URL, and ignores the URL", () => {
    const file = tempFile();
    writeAgentEnvFile(
      file,
      `SAPPORTA_API_URL=http://localhost:1\nSAPPORTA_API_TOKEN=${VALUES.apiToken}\n`,
    );

    expect(readAgentEnvValues(file)).toEqual(VALUES);
  });

  it("answers null for a file that is not there", () => {
    expect(readAgentEnvValues(tempFile())).toBeNull();
  });

  it("answers null when the token is missing or blank", () => {
    const noToken = tempFile();
    writeAgentEnvFile(noToken, "SAPPORTA_API_URL=http://localhost:1\n");
    expect(readAgentEnvValues(noToken)).toBeNull();

    const blank = tempFile();
    writeAgentEnvFile(blank, "SAPPORTA_API_TOKEN=\n");
    expect(readAgentEnvValues(blank)).toBeNull();
  });
});

describe("agentEnvPath", () => {
  it("is the file the guides, the shipped bin and the checker all name", () => {
    expect(agentEnvPath("/sample/project")).toBe(
      join("/sample/project", AGENT_ENV_FILE),
    );
    expect(AGENT_ENV_FILE).toBe(".env.agent");
  });
});
