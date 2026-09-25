import { extendCn } from "@sapporta/ui/cn";

/** The type scale frontend.css registers as `text-*` sizes. */
export const TYPE_SCALE = [
  "display",
  "title",
  "heading",
  "subheading",
  "body",
  "row",
  "meta",
  "label",
] as const;

/**
 * Tells class merging about the type scale, so `cn` keeps a size next to a
 * colour instead of reading `text-body` as one. `startDbu6Frontend` calls it,
 * and so does the frontend tests' setup, so both merge classes alike.
 */
export function registerTypeScale(): void {
  extendCn({ text: [...TYPE_SCALE] });
}
