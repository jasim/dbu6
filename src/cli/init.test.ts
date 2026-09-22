import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageDir } from "../server/paths.js";
import {
  initCommand,
  initProject,
  projectSlug,
  renderTemplate,
  SQLITE_PROBE,
} from "./init.js";
import type { RunCommand } from "./upgrade.js";

let parent: string;
let logged: string[];
let commands: string[];

const ownVersion = () =>
  (
    JSON.parse(readFileSync(packageDir("package.json"), "utf8")) as {
      version: string;
    }
  ).version;

/**
 * A runner that leaves behind what `npm install` would (the installed
 * package's manifest and bin) and exits the other commands as told.
 */
function runner(
  exits: Record<string, number> = {},
  { git = true } = {},
): RunCommand {
  return async (command, args, { cwd }) => {
    const shown = [command === process.execPath ? "node" : command, ...args]
      .join(" ")
      .replaceAll(cwd, "<root>");
    commands.push(shown);
    if (command === "git" && !git) {
      throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    }
    if (command === "npm" && args[0] === "install") {
      const dir = join(cwd, "node_modules", "dbu6");
      mkdirSync(join(dir, "bin"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "dbu6", version: "1.2.3" }),
      );
      writeFileSync(join(dir, "bin", "dbu6.mjs"), "");
    }
    const key = command === "git" ? `git ${args[0]}` : (args.at(-1) as string);
    return { status: exits[key] ?? 0, stdout: "" };
  };
}

beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "dbu6-init-"));
  logged = [];
  commands = [];
});

afterEach(() => rmSync(parent, { recursive: true, force: true }));

const init = (run: RunCommand, name = "sample-books", dbu6?: string) =>
  initProject({
    target: join(parent, name),
    run,
    dbu6,
    log: (line) => logged.push(line),
  });

const read = (name: string, ...path: string[]) =>
  readFileSync(join(parent, name, ...path), "utf8");

describe("initProject", () => {
  it("renders the template, installs, sets up, migrates and commits, in that order", async () => {
    const result = await init(runner());
    const root = join(parent, "sample-books");

    expect(result).toEqual({
      root,
      name: "sample-books",
      version: ownVersion(),
      committed: true,
    });
    const manifest = JSON.parse(read("sample-books", "package.json"));
    expect(manifest.name).toBe("sample-books");
    expect(manifest.dependencies).toEqual({ dbu6: ownVersion() });
    // Every template file, `gitignore` under its real name.
    expect(existsSync(join(root, ".gitignore"))).toBe(true);
    expect(existsSync(join(root, "gitignore"))).toBe(false);
    for (const file of ["AGENTS.md", "tsconfig.json", ".env.example"]) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
    const bin = "<root>/node_modules/dbu6/bin/dbu6.mjs";
    expect(commands).toEqual([
      "npm install",
      `node -e ${SQLITE_PROBE}`,
      `node ${bin} setup`,
      `node ${bin} migrate`,
      "git --version",
      "git init",
      "git add .",
      "git commit -m Create dbu6 project",
    ]);
  });

  it("leaves no token in any file", async () => {
    await init(runner());
    const root = join(parent, "sample-books");
    for (const file of globSync("**/*", {
      cwd: root,
      exclude: (name) => name === "node_modules",
    })) {
      const path = join(root, file);
      if (!existsSync(path) || file.startsWith("node_modules")) continue;
      try {
        expect(readFileSync(path, "utf8"), file).not.toContain("%%SAPPORTA");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EISDIR") throw error;
      }
    }
  });

  it("installs from a given spec, for an unpublished build", async () => {
    await init(runner(), "sample-books", "file:/packed/dbu6-1.2.3.tgz");
    expect(
      JSON.parse(read("sample-books", "package.json")).dependencies.dbu6,
    ).toBe("file:/packed/dbu6-1.2.3.tgz");
  });

  it("names the package after the directory, in npm's form", async () => {
    await init(runner(), "My Books 2026");
    expect(JSON.parse(read("My Books 2026", "package.json")).name).toBe(
      "my-books-2026",
    );
  });

  it("refuses a directory that has anything in it", async () => {
    mkdirSync(join(parent, "taken"));
    writeFileSync(join(parent, "taken", "notes.txt"), "mine");
    await expect(init(runner(), "taken")).rejects.toThrow(/is not empty/);
    expect(commands).toEqual([]);
    // Nothing was written into it.
    expect(existsSync(join(parent, "taken", "package.json"))).toBe(false);
  });

  it("refuses a target that is a file", async () => {
    writeFileSync(join(parent, "file"), "");
    await expect(init(runner(), "file")).rejects.toThrow(/not a directory/);
  });

  it("accepts an existing empty directory", async () => {
    mkdirSync(join(parent, "empty"));
    await expect(init(runner(), "empty")).resolves.toMatchObject({
      name: "empty",
    });
  });

  it("builds the sqlite binding when the install left it out", async () => {
    await init(runner({ [SQLITE_PROBE]: 1 }));
    expect(commands).toContain(
      "npm rebuild better-sqlite3 --ignore-scripts=false",
    );
  });

  it("stops, and says the folder is left as it is, when install fails", async () => {
    await expect(init(runner({ install: 1 }))).rejects.toThrow(
      /npm install failed.*left as it is/,
    );
    expect(commands).toEqual(["npm install"]);
  });

  it("stops when the installed package's migrate fails", async () => {
    await expect(init(runner({ migrate: 1 }))).rejects.toThrow(
      /dbu6 migrate failed/,
    );
    expect(commands.some((c) => c.startsWith("git"))).toBe(false);
  });

  it("skips the commit, with a note, when git is not installed", async () => {
    const result = await init(runner({}, { git: false }));
    expect(result.committed).toBe(false);
    expect(commands.filter((c) => c.startsWith("git"))).toEqual([
      "git --version",
    ]);
    expect(logged.join("\n")).toContain("git is not installed");
  });

  it("leaves the files staged, with a note, when git cannot commit", async () => {
    const result = await init(runner({ "git commit": 1 }));
    expect(result.committed).toBe(false);
    expect(logged.join("\n")).toContain("name and email");
  });
});

describe("renderTemplate", () => {
  it("fills every token and renames gitignore", () => {
    const dir = join(parent, "template");
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "gitignore"), "data/\n");
    writeFileSync(
      join(dir, "nested", "a.txt"),
      "%%SAPPORTA:SLUG%% %%SAPPORTA:SLUG%%",
    );
    expect(renderTemplate(dir, { "%%SAPPORTA:SLUG%%": "x" })).toEqual([
      { path: ".gitignore", content: "data/\n" },
      { path: "nested/a.txt", content: "x x" },
    ]);
  });

  it("refuses a token it has no value for, naming the file", () => {
    const dir = join(parent, "template");
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), "%%SAPPORTA:UNKNOWN%%");
    expect(() => renderTemplate(dir, {})).toThrow(
      /template\/package\.json .* %%SAPPORTA:UNKNOWN%%/,
    );
  });

  it("fills dbu6's own template with the two variables init has", () => {
    const files = renderTemplate(packageDir("template"), {
      "%%SAPPORTA:SLUG%%": "sample",
      "%%SAPPORTA:DBU6_VERSION%%": "1.2.3",
    });
    expect(files.map((file) => file.path)).toEqual([
      ".dockerignore",
      ".env.example",
      ".gitignore",
      "AGENTS.md",
      "Dockerfile",
      "package.json",
      "sapporta.json",
      "tsconfig.json",
    ]);
  });
});

describe("initCommand", () => {
  it("needs exactly one directory", async () => {
    expect(await initCommand([], runner())).toBe(1);
    expect(await initCommand(["a", "b"], runner())).toBe(1);
    expect(await initCommand(["--unknown"], runner())).toBe(1);
    expect(commands).toEqual([]);
  });

  it("creates the project and passes --dbu6 through", async () => {
    expect(
      await initCommand(
        [join(parent, "books"), "--dbu6", "file:/x.tgz"],
        runner(),
      ),
    ).toBe(0);
    expect(JSON.parse(read("books", "package.json")).dependencies.dbu6).toBe(
      "file:/x.tgz",
    );
  });
});

describe("projectSlug", () => {
  it("lowercases and replaces what npm does not accept", () => {
    expect(projectSlug("My Books")).toBe("my-books");
    expect(projectSlug("")).toBe("my-books");
  });
});
