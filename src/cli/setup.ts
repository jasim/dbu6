/**
 * `dbu6 setup`: what a project needs between installing and its first start,
 * other than a database (`dbu6 migrate`): the environment file, an auth
 * secret in it, and `user-config/`.
 *
 * It runs on every `dev`, so each step only fills in what is missing and
 * never overwrites a file someone has edited.
 */
import { randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { packageDir, userConfigDir } from "../server/paths.js";
import { envFile } from "./project.js";

export async function setupProject(root: string): Promise<void> {
  await createEnvFile(root);
  await fillAuthSecret(root);
  await seedUserConfig(root);
}

async function createEnvFile(root: string): Promise<void> {
  const target = envFile(root);
  const example = packageDir("template", ".env.example");
  if (!(await copyUnlessPresent(example, target))) return;
  console.log(`Created ${basename(target)} from ${basename(example)}.`);
}

/**
 * Gives a blank `BETTER_AUTH_SECRET=` a value. Better Auth signs session
 * cookies with it and refuses to start without one. The file is gitignored
 * and local to this machine; changing the secret later only signs people out.
 */
async function fillAuthSecret(root: string): Promise<void> {
  const file = envFile(root);
  const contents = await readFile(file, "utf8");
  const blank = /^BETTER_AUTH_SECRET=[ \t]*$/m;
  if (!blank.test(contents)) return;
  const secret = randomBytes(32).toString("base64");
  await writeFile(
    file,
    contents.replace(blank, `BETTER_AUTH_SECRET=${secret}`),
  );
  console.log(`Generated BETTER_AUTH_SECRET in ${basename(file)}.`);
}

/** Fills `<root>/user-config/` from the package's example config. */
async function seedUserConfig(root: string): Promise<void> {
  const exampleDir = packageDir("user-config.example");
  const targetDir = userConfigDir(root);
  await mkdir(targetDir, { recursive: true });

  const copied: string[] = [];
  for (const entry of await readdir(exampleDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const created = await copyUnlessPresent(
      join(exampleDir, entry.name),
      join(targetDir, entry.name),
    );
    if (created) copied.push(entry.name);
  }
  if (copied.length > 0) {
    console.log(`Filled ${targetDir} from dbu6's example config:`);
    for (const name of copied) console.log(`  ${name}`);
    console.log("\nEdit these to match your own accounts before importing.");
  }

  // Before user-config/ moved to the project root it sat in data/. That copy
  // is no longer read, and nothing moves it.
  const formerDir = join(root, "data", "user-config");
  if (existsSync(formerDir)) {
    console.log(
      `\n${formerDir} is no longer read. Move its files to ${targetDir}.`,
    );
  }
}

/** Copies, and returns false when the target already exists. */
async function copyUnlessPresent(
  source: string,
  target: string,
): Promise<boolean> {
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
