/*
 * The rules about a bank's name, shared by /add's reading (the server's
 * prefill), its add (the name the user sends) and the forms that type one.
 */

/**
 * The bank the books know that `typed` names, ignoring case and extra
 * spaces, else the typed name as it is: "sample  bank" is "Sample Bank",
 * never a second bank.
 */
export function knownInstitution(
  institutions: readonly string[],
  typed: string,
): string {
  const text = typed.trim().replace(/\s+/g, " ");
  const key = text.toLowerCase();
  return (
    institutions.find(
      (name) => name.trim().replace(/\s+/g, " ").toLowerCase() === key,
    ) ?? text
  );
}

/*
 * The bank's name as a statement prints it, tidied for the presets:
 * "Ltd", "Ltd." and "Limited" go, and so does trailing punctuation. An
 * all-caps word longer than four letters is title-cased ("STANDARD" is
 * "Standard"); a shorter one is kept as an acronym ("HDFC", "SBI"), except
 * the words a bank's name is made of ("BANK" is "Bank"; "OF" is "of", and
 * "The" when it leads). Words printed in mixed case are kept as printed.
 */
const COMPANY_SUFFIX = /^(ltd|limited)\.?$/i;
const COMMON_WORDS = new Map([
  ["BANK", "Bank"],
  ["CARD", "Card"],
  ["CARDS", "Cards"],
]);
const JOINING_WORDS = new Set(["OF", "AND", "THE", "FOR"]);

export function tidyBankName(printed: string): string {
  const words = printed
    .split(/\s+/)
    .map((word) => word.replace(/[,;:]+$/, ""))
    .filter((word) => word !== "" && !COMPANY_SUFFIX.test(word));
  return words
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      if (letters === "" || letters !== letters.toUpperCase()) return word;
      const common = COMMON_WORDS.get(letters);
      if (common !== undefined) return word.replace(letters, common);
      if (JOINING_WORDS.has(letters)) {
        return index > 0 ? word.toLowerCase() : titleCase(word);
      }
      return letters.length <= 4 ? word : titleCase(word);
    })
    .join(" ")
    .replace(/[\s.,;:\-–—]+$/, "");
}

function titleCase(word: string): string {
  return word.toLowerCase().replace(/[a-z]/, (first) => first.toUpperCase());
}
