// Text as transaction identity compares it: narrations, references and
// account names match once case, width and spacing no longer differ.
export function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}
