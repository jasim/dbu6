import type { SampleFinding, StatementFormatRow } from "../../shared/index";
import { parserLabel } from "../format";

/*
 * An account's statement format, split into the two things it needs: a
 * parser its institution lists (Format) and the number its statements print
 * (Number). The screen shows each as a short label with a mark, rather than
 * a sentence, for the account as it is and for what a sample would change.
 */

export type CheckState =
  // In place.
  | "set"
  // The sample sets it once accepted.
  | "adds"
  // Not there, and nothing sets it yet.
  | "missing"
  // A sample waits for a coding agent to write its parser.
  | "waiting"
  // The sample says otherwise than the account.
  | "conflict";

export interface Check {
  label: "Format" | "Number";
  state: CheckState;
  value: string | null;
  // A few words after the value: "moves to Sample Cards", "you gave …".
  note: string | null;
}

type Recognized = Extract<SampleFinding, { outcome: "recognized" }>;

/** The account's two checks as the books hold them now. */
export function rowChecks(row: StatementFormatRow): Check[] {
  return [
    row.parsers.length > 0
      ? {
          label: "Format",
          state: "set",
          value: row.parsers.map(parserLabel).join(", "),
          note: null,
        }
      : {
          label: "Format",
          state: row.staged_sample === null ? "missing" : "waiting",
          value: null,
          note: row.staged_sample === null ? null : "parser being written",
        },
    row.account_identifiers.length > 0
      ? {
          label: "Number",
          state: "set",
          value: row.account_identifiers.join(", "),
          note: null,
        }
      : { label: "Number", state: "missing", value: null, note: null },
  ];
}

/** The account's two checks as they would be with the sample's changes. */
export function findingChecks(
  row: StatementFormatRow,
  finding: Recognized,
): Check[] {
  const parser = parserLabel(finding.parser);
  const format: Check = finding.moves
    ? {
        label: "Format",
        state: "adds",
        value: parser,
        note: `moves to ${finding.institution}`,
      }
    : finding.parser_institution === null
      ? { label: "Format", state: "adds", value: parser, note: "new" }
      : { label: "Format", state: "set", value: parser, note: null };

  const printed = finding.printed_identifier;
  const own = row.account_identifiers[0] ?? null;
  const number: Check = {
    none_printed:
      own === null
        ? {
            label: "Number",
            state: "missing",
            value: null,
            note: "not on the statement",
          }
        : { label: "Number", state: "set", value: own, note: null },
    set: { label: "Number", state: "adds", value: printed, note: "new" },
    same: { label: "Number", state: "set", value: printed, note: null },
    different: {
      label: "Number",
      state: "conflict",
      value: printed,
      note: `you gave ${own}`,
    },
  }[finding.identifier_state] as Check;

  return [format, number];
}
