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
  it("cds to the project root and runs the binary on the prompt file", () => {
    expect(
      launcherScript({
        projectRoot: "/sample/dbu6",
        binaryPath: "/sample/bin/claude",
        promptPath: "/sample/dbu6/tmp/agent-prompts/sample.md",
      }),
    ).toBe(
      [
        "#!/bin/sh",
        "cd '/sample/dbu6' || exit 1",
        `exec '/sample/bin/claude' -- "$(cat '/sample/dbu6/tmp/agent-prompts/sample.md')"`,
        "",
      ].join("\n"),
    );
  });

  it("quotes paths with spaces and single quotes", () => {
    const script = launcherScript({
      projectRoot: "/sample/NOPII's books",
      binaryPath: "/sample/my bin/codex",
      promptPath: "/sample/NOPII's books/tmp/agent-prompts/sample.md",
    });

    expect(script).toContain(`cd '/sample/NOPII'\\''s books' || exit 1`);
    expect(script).toContain(
      `exec '/sample/my bin/codex' -- "$(cat '/sample/NOPII'\\''s books/tmp/agent-prompts/sample.md')"`,
    );
  });
});

describe.skipIf(process.platform === "win32")("running a launcher", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("runs the given binary in the project root with the prompt unchanged after its options end", async () => {
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
    // A stand-in agent that reports where it ran and what it was given.
    await writeFile(
      binaryPath,
      '#!/bin/sh\nprintf "%s\\n%s\\n%s\\n%s" "$#" "$(pwd -P)" "$1" "$2"\n',
    );
    await chmod(binaryPath, 0o700);
    await writeFile(promptPath, PROMPT);
    await writeFile(
      launcherPath,
      launcherScript({ projectRoot, binaryPath, promptPath }),
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

    const [argumentCount, workingDir, endOfOptions, ...prompt] =
      stdout.split("\n");
    expect(argumentCount).toBe("2");
    expect(endOfOptions).toBe("--");
    expect(workingDir).toBe(
      (
        await run("/bin/sh", ["-c", "pwd -P"], { cwd: projectRoot })
      ).stdout.trim(),
    );
    expect(prompt.join("\n")).toBe(PROMPT);
  });
});
