/**
 * Money is stored and computed as integer paisa (৳1 = 100 paisa).
 * These helpers only format for display; they never do arithmetic on floats.
 */
export function formatTaka(paisa) {
  if (paisa === null || paisa === undefined) return null;
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  const taka = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}৳${taka.toLocaleString('en-US')}.${rest}`;
}
