import type {
  ImportInstitution,
  ImportPresetChange,
} from "../../../shared/index.js";

/*
 * A first statement the setup wizard recognized with parser P, printing
 * the number I, for one preset account: the preset changes that would tie
 * the account to P. Nothing is written here; importing the statement makes
 * them, through the presets' writer.
 *
 * - P listed by no institution: the account's institution lists it.
 * - P listed by the account's institution: nothing to add.
 * - P listed by another institution: a parser belongs to one institution,
 *   so the account moves there.
 * - I and the account's numbers: none on the account takes I; I already
 *   there changes nothing; another number is a mismatch, and the
 *   statement's replaces the typed one once the user accepts it.
 */

export type SampleIdentifierState =
  "none_printed" | "set" | "same" | "different";

export interface SampleProposal {
  /** The institution that lists the parser now, if any. */
  parserInstitution: string | null;
  /** The account's institution after the changes. */
  institution: string;
  /** Whether the account moves to the parser's institution. */
  moves: boolean;
  identifierState: SampleIdentifierState;
  /** The changes with the statement's number. */
  changes: ImportPresetChange[];
}

/** Pure: what ties `accountId` to `parser`; null when no preset lists it. */
export function proposeSampleChanges(
  institutions: readonly ImportInstitution[],
  accountId: number,
  parser: string,
  printed: string | null,
): SampleProposal | null {
  const home = institutions.find((institution) =>
    institution.accounts.some((one) => one.account_id === accountId),
  );
  if (home === undefined) return null;
  const account = home.accounts.find((one) => one.account_id === accountId)!;
  const lister =
    institutions.find((institution) => institution.parsers.includes(parser)) ??
    null;
  const own = account.account_identifiers;

  const identifierState: SampleIdentifierState =
    printed === null
      ? "none_printed"
      : own.length === 0
        ? "set"
        : own.includes(printed)
          ? "same"
          : "different";
  const statements =
    printed === null || identifierState === "same"
      ? own
      : [printed, ...own.slice(1).filter((one) => one !== printed)];

  const changesWith = (
    identifiers: readonly string[],
  ): ImportPresetChange[] => {
    const identifierChange: ImportPresetChange[] =
      identifiers === own
        ? []
        : [
            {
              kind: "update_account",
              account_id: accountId,
              account_identifiers: [...identifiers],
            },
          ];
    if (lister === null) {
      return [
        { kind: "add_parser", institution: home.name, parser },
        ...identifierChange,
      ];
    }
    if (lister.name === home.name) return identifierChange;
    return [
      { kind: "remove_account", account_id: accountId },
      {
        kind: "add_account",
        institution: lister.name,
        ...account,
        account_identifiers: [...identifiers],
      },
    ];
  };

  const moves = lister !== null && lister.name !== home.name;
  return {
    parserInstitution: lister?.name ?? null,
    institution: moves ? lister.name : home.name,
    moves,
    identifierState,
    changes: changesWith(statements),
  };
}
