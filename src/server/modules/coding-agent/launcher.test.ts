import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { launcherCommand, launcherScript } from "./launcher.js";

const run = promisify(execFile);

const PROMPT = [
  "--settings={} I dropped `sample statement.pdf` on the import screen.",
  'Re-run with: curl -H "Authorization: Bearer $SAPPORTA_API_TOKEN" "$SAPPORTA_API_URL/api/import-draft/statements/auto"',
  "A path with backslashes: C:\\sample\\050505 and $(echo not-run) and 'quotes'.",
].join("\n");

describe("launcherScript", () => {
  it("cds to the project root and runs the binary with its options on the prompt file", () => {
    expect(
      launcherScript({
        projectRoot: "/sample/dbu6",
        binaryPath: "/sample/bin/claude",
        agentArgs: ["--model", "opus", "--permission-mode", "auto"],
        promptPath: "/sample/dbu6/tmp/agent-prompts/sample.md",
      }),
    ).toBe(
      [
        "#!/bin/sh",
        "cd '/sample/dbu6' || exit 1",
        `exec '/sample/bin/claude' '--model' 'opus' '--permission-mode' 'auto' -- "$(cat '/sample/dbu6/tmp/agent-prompts/sample.md')"`,
        "",
      ].join("\n"),
    );
  });

  it("quotes paths with spaces and single quotes", () => {
    const script = launcherScript({
      projectRoot: "/sample/NOPII's books",
      binaryPath: "/sample/my bin/codex",
      agentArgs: ["--model", "gpt-5.6-terra", "--approve-for-me"],
      promptPath: "/sample/NOPII's books/tmp/agent-prompts/sample.md",
    });

    expect(script).toContain(`cd '/sample/NOPII'\\''s books' || exit 1`);
    expect(script).toContain(
      `exec '/sample/my bin/codex' '--model' 'gpt-5.6-terra' '--approve-for-me' -- "$(cat '/sample/NOPII'\\''s books/tmp/agent-prompts/sample.md')"`,
    );
  });
});

describe.skipIf(process.platform === "win32")("running a launcher", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("runs the given binary in the project root with its options, then the prompt unchanged after they end", async () => {
    dir = await mkdtemp(join(tmpdir(), "dbu6-launcher-"));
    const projectRoot = join(dir, "NOPII's books");
    const binaryPath = join(dir, "my bin", "agent");
    const promptPath = join(projectRoot, "tmp", "agent-prompts", "sample.md");
    const launcherPath = join(
      projectRoot,
      "tmp",
      "agent-prompts",
      "sample.command",
    );
    await mkdir(join(projectRoot, "tmp", "agent-prompts"), { recursive: true });
    await mkdir(join(dir, "my bin"));
    // A stand-in agent that reports where it ran and what it was given, one
    // argument a line.
    await writeFile(
      binaryPath,
      '#!/bin/sh\nprintf "%s\\n%s" "$#" "$(pwd -P)"\nprintf "\\n%s" "$@"\n',
    );
    await chmod(binaryPath, 0o700);
    await writeFile(promptPath, PROMPT);
    await writeFile(
      launcherPath,
      launcherScript({
        projectRoot,
        binaryPath,
        agentArgs: ["--model", "gpt-5.6-sol", "--approve-for-me"],
        promptPath,
      }),
    );

    const { stdout } = await run(
      "/bin/sh",
      ["-c", launcherCommand(launcherPath)],
      {
        env: {
          PATH: "/usr/bin:/bin",
          SAPPORTA_API_TOKEN: "expanded",
          SAPPORTA_API_URL: "expanded",
        },
      },
    );

    const [argumentCount, workingDir, ...lines] = stdout.split("\n");
    expect(argumentCount).toBe("5");
    expect(lines.slice(0, 4)).toEqual([
      "--model",
      "gpt-5.6-sol",
      "--approve-for-me",
      "--",
    ]);
    expect(workingDir).toBe(
      (
        await run("/bin/sh", ["-c", "pwd -P"], { cwd: projectRoot })
      ).stdout.trim(),
    );
    expect(lines.slice(4).join("\n")).toBe(PROMPT);
  });
});
