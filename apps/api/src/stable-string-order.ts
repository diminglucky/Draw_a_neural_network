/**
 * Compares identifiers by JavaScript UTF-16 code units, never the host locale.
 * Canonical graph and Figure Plan hashes rely on this ordering being identical
 * on every supported host.
 */
export function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
