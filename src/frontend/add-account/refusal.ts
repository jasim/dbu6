import type {
  AccountKind,
  AddAccountCandidate,
  AddAccountFile,
  AutoImportPlanFile,
  StatementImportError,
} from "../../shared/index";
import {
  describeProblems,
  type Problem,
} from "../views/import-statements/describeProblems";

/*
 * A refusal the read found, in /import's words: the same problem, fix and
 * coding-agent prompt /import would show had the files been dropped there.
 * /import's refusal carries the batch's files and the account that failed,
 * so they are filled in here from the read: each file's parser and its
 * staged copy (kept when the refusal gets a prompt), for the account `add`
 * would make.
 */
export function refusalProblems(
  account: AddAccountCandidate,
  refusal: StatementImportError,
  files: readonly AddAccountFile[],
  name: string,
  kind: AccountKind | null,
): Problem[] {
  const planFiles = account.file_names.flatMap(
    (fileName): AutoImportPlanFile[] => {
      const file = files.find((one) => one.file_name === fileName);
      if (file?.status !== "read") return [];
      return [
        {
          status: "resolved",
          file_name: fileName,
          saved_path: file.saved_path,
          parser_path: file.parser,
          account: null,
          institution: account.institution === "" ? null : account.institution,
          account_id: account.account?.id ?? 0,
          account_name: name,
        },
      ];
    },
  );
  return describeProblems({
    kind: "account-refused",
    refusal: {
      ...refusal,
      files: planFiles,
      failed_group: {
        account_id: account.account?.id ?? 0,
        account_name: name,
        base_account: name,
        is_credit_card: kind === "card",
        file_names: account.file_names,
      },
    },
  });
}
