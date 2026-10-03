/** Calendar date (YYYY-MM-DD) in the device's own timezone, optionally shifted by whole days.
 *  `toISOString()` is UTC, which makes "today" wrong for anyone far from Greenwich for part of every day. */
export function localDate(offsetDays = 0, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
