/** `dbu6 docs [name]`: the guides dbu6 ships for coding agents (`GUIDES`). */
import { readFileSync } from "node:fs";
import { GUIDES, type GuideName } from "../shared/guides.js";
import { packageDir } from "../server/paths.js";

export function printDocs(name: string | undefined): number {
  if (name === undefined) {
    console.log("Guides (dbu6 docs <name>):\n");
    const width = Math.max(...Object.keys(GUIDES).map((key) => key.length));
    for (const [key, guide] of Object.entries(GUIDES)) {
      console.log(`  ${key.padEnd(width)}  ${guide.title}`);
    }
    return 0;
  }
  if (!Object.hasOwn(GUIDES, name)) {
    console.error(
      `There is no guide named ${name}. The guides are: ${Object.keys(GUIDES).join(", ")}.`,
    );
    return 1;
  }
  const guide: { file: string; examples?: readonly string[] } =
    GUIDES[name as GuideName];
  process.stdout.write(readFileSync(packageDir(guide.file), "utf8"));
  // The worked example's files, printed from where they are typechecked.
  for (const example of guide.examples ?? []) {
    const fence = "```";
    process.stdout.write(
      `\n### ${example}\n\n${fence}${example.endsWith("x") ? "tsx" : "ts"}\n` +
        `${readFileSync(packageDir(example), "utf8")}${fence}\n`,
    );
  }
  return 0;
}
