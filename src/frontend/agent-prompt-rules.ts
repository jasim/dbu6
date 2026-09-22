// What every prompt for the user's coding agent asks, wherever the app hands
// one over (Import, Review). The PII rule sits inside each prompt; the plan
// comes first in all of them, and the AI-assisted panel puts it there.
import { guideCommand } from "../shared/index";

// The conventions are in the parsers guide, which ships with dbu6; a user's
// project has no copy of this repository's AGENTS.md.
export const PII_RULE = `Never put real names, account numbers, references, or amounts in the
repository. Use the 050505 / NOPII / sample conventions for any fixture or
test; \`${guideCommand("parsers")}\` prints them, under "No Real Data In Fixtures And
Tests".`;

// Where an agent's work goes. dbu6 itself, its bundled parsers included, is an
// installed package in the user's project, and an upgrade replaces it.
export const PROJECT_FILES_RULE = `Write new parsers only in this project's custom-built-parsers/ directory and
new reports only in its reports/ directory. dbu6 and the parsers bundled with
it are an installed package: never edit anything under node_modules. To change
a bundled parser, copy its directory into custom-built-parsers/ under the same
name, where it takes the bundled one's place, and change the copy.`;

// Nothing an agent does should start on its own: a prompt opens a session
// that runs in the agent's auto mode, so the user first sees what the work is
// for and how it will go, and says go. The plan is kept to the idea and a few
// short steps; the detail comes as the agent works.
export const PLAN_FIRST_RULE = `Before you do anything, tell me in a few lines what you are going to do, and
wait for my go-ahead.

Your first reply is only this, in plain words:

- One sentence on the big idea: what you will build, fix or find out, and
  what that gets me.
- Then at most five steps, each a short sentence of a dozen words or so.

Leave out file names, commands, how you'll keep to the request's rules, and
what you won't do. End by asking whether to go ahead. Don't read or change
files, run commands or call the app's API until I say go. If I change the
plan, show it again and wait. If the work later needs something the plan
didn't say, stop and ask me first.

The request:`;

/** A prompt as the agent gets it: the plan-first rule, then the prompt. */
export function planFirst(prompt: string): string {
  return `${PLAN_FIRST_RULE}\n\n${prompt}`;
}
