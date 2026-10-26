/**
 * Whether a key goes to something being typed into or a popup that reads
 * keys itself, so a screen's own shortcuts leave it alone.
 */
export function typingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest(
        "input,textarea,select,[role=dialog],[role=listbox],[role=menu]",
      ) !== null)
  );
}
