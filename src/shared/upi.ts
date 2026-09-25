/**
 * Whether a mapping value is a UPI VPA (`payee@psp`). An exact rule that is
 * one also matches the VPA inside a longer narration, not only the whole
 * narration (src/server/modules/categorization/mapping-rules.ts).
 */
export function isVpa(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}
