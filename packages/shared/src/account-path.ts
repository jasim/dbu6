/**
 * The friendly name of an account path: its last segment, with hyphens and
 * underscores as spaces and a capital first letter.
 * `expenses:food:food-delivery` is "Food delivery"; `expenses:food` is
 * "Food". The everyday screens show this where a path would be; the path
 * itself goes only into tooltips and accessible names.
 */
export function accountPathName(path: string): string {
  const last = path
    .split(":")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .at(-1);
  if (last === undefined) return "";
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
