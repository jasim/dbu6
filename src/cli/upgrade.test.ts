import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  upgradeProject,
  type RunCommand,
} from "./upgrade.js";

let root: string;
let logged: string[];
let commands: string[];

const manifestOf = (version: string) =>
  `${JSON.stringify({ name: "sample-books", dependencies: { dbu6: version } }, null, 2)}\n`;
const lockfileOf = (version: string) => `{"sample-lock":"${version}"}\n`;
const read = (name: string) => readFileSync(join(root, name), "utf8");

/** What `npm install` leaves behind: the pinned version, and a lockfile. */
function installPinned(): void {
  const { dependencies } = JSON.parse(read("package.json"));
  const dir = join(root, "node_modules", "dbu6");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "docs", "upgrade-notes"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "dbu6", version: dependencies.dbu6 }),
  );
  for (const version of ["1.0.0", "1.1.0", "1.2.0", "2.0.0"]) {
    if (compareVersions(version, dependencies.dbu6) > 0) continue;
    writeFileSync(
      join(dir, "docs", "upgrade-notes", `${version}.md`),
      `Notes of ${version}.\n`,
    );
  }
  writeFileSync(join(root, "package-lock.json"), lockfileOf(dependencies.dbu6));
}

/** A runner that installs as above, and exits `dbu6 <name>` as told. */
function runner(exits: { migrate?: number; check?: number } = {}): RunCommand {
  return async (command, args) => {
    commands.push([command === process.execPath ? "node" : command, ...args].join(" "));
    if (command === "npm" && args[0] === "view") {
      return { status: 0, stdout: "1.2.0\n" };
    }
    if (command === "npm" && args[0] === "install") {
      installPinned();
      return { status: 0, stdout: "" };
    }
    const name = args.at(-1) as "migrate" | "check";
    return { status: exits[name] ?? 0, stdout: "" };
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dbu6-upgrade-"));
  logged = [];
  commands = [];
  writeFileSync(join(root, "package.json"), manifestOf("1.0.0"));
  installPinned();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const upgrade = (run: RunCommand, version?: string) =>
  upgradeProject({ root, version, run, log: (line) => logged.push(line) });

describe("upgradeProject", () => {
  it("pins the latest version, installs, prints the notes between, migrates, checks", async () => {
    const result = await upgrade(runner());

    expect(result).toEqual({
      status: "upgraded",
      from: "1.0.0",
      to: "1.2.0",
      checkPassed: true,
    });
    expect(JSON.parse(read("package.json")).dependencies.dbu6).toBe("1.2.0");
    const bin = join(root, "node_modules", "dbu6", "bin", "dbu6.mjs");
    expect(commands).toEqual([
      "npm view dbu6 version",
      "npm install",
      `node ${bin} migrate`,
      `node ${bin} check`,
    ]);
    const notes = logged.filter((line) => line.includes("Upgrade notes"));
    // After 1.0.0, up to 1.2.0, oldest first.
    expect(notes.map((line) => line.match(/for (\S+)/)?.[1])).toEqual([
      "1.1.0",
      "1.2.0",
    ]);
  });

  it("puts the old version back when the migration does not verify", async () => {
    const result = await upgrade(runner({ migrate: 1 }), "2.0.0");

    expect(result).toMatchObject({ status: "rolled-back", from: "1.0.0", to: "2.0.0" });
    expect(read("package.json")).toBe(manifestOf("1.0.0"));
    expect(read("package-lock.json")).toBe(lockfileOf("1.0.0"));
    // Reinstalled from the restored files, and never checked.
    expect(commands.at(-1)).toBe("npm install");
    expect(commands.some((command) => command.endsWith(" check"))).toBe(false);
    expect(
      JSON.parse(read("node_modules/dbu6/package.json")).version,
    ).toBe("1.0.0");
    expect(logged.join("\n")).toContain("back on dbu6 1.0.0");
  });

  it("removes a lockfile the failed upgrade created", async () => {
    rmSync(join(root, "package-lock.json"));
    const run = runner({ migrate: 1 });
    await upgradeProject({
      root,
      version: "2.0.0",
      log: (line) => logged.push(line),
      // The rollback's reinstall would write one again; only the restore is
      // under test.
      run: async (command, args, options) =>
        commands.filter((c) => c === "npm install").length === 1 &&
        args[0] === "install"
          ? { status: 1, stdout: "" }
          : run(command, args, options),
    });

    expect(existsSync(join(root, "package-lock.json"))).toBe(false);
    expect(logged.join("\n")).toContain("reinstalling it failed");
  });

  it("stays upgraded, and says so, when check finds problems", async () => {
    const result = await upgrade(runner({ check: 1 }), "1.1.0");
    expect(result).toMatchObject({ status: "upgraded", checkPassed: false });
    expect(JSON.parse(read("package.json")).dependencies.dbu6).toBe("1.1.0");
  });

  it("does nothing when the project is already on the version", async () => {
    expect(await upgrade(runner(), "1.0.0")).toEqual({
      status: "unchanged",
      version: "1.0.0",
    });
    expect(commands).toEqual([]);
  });

  it("refuses a range", async () => {
    await expect(upgrade(runner(), "^1.2.0")).rejects.toThrow(/exact version/);
  });

  it("refuses an older version, and changes nothing", async () => {
    writeFileSync(join(root, "package.json"), manifestOf("1.2.0"));
    installPinned();

    await expect(upgrade(runner(), "1.1.0")).rejects.toThrow(
      /1\.1\.0 is older than 1\.2\.0.*does not downgrade/,
    );
    expect(commands).toEqual([]);
    expect(JSON.parse(read("package.json")).dependencies.dbu6).toBe("1.2.0");
  });
});

describe("compareVersions", () => {
  it("orders numerically, a prerelease before its release", () => {
    const versions = ["1.10.0", "1.2.0", "1.2.0-beta.1", "0.9.9"];
    expect(versions.sort(compareVersions)).toEqual([
      "0.9.9",
      "1.2.0-beta.1",
      "1.2.0",
      "1.10.0",
    ]);
  });
});
