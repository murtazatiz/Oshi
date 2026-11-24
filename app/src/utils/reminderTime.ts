/**
 * Reminder times are stored in UTC as TIMETZ strings ("19:00:00+00") and
 * edited in the device's local time. Conversions use today's date, so the
 * current DST offset applies.
 */

/** Local wall-clock hour/minute → UTC "HH:MM:00+00". */
export function localToUtcTimetz(hour: number, minute: number): string {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}:00+00`;
}

/** UTC "HH:MM[:SS]+00" → local wall-clock hour/minute. */
export function utcTimetzToLocal(timetz: string): { hour: number; minute: number } {
  const [hStr, mStr] = timetz.split(':');
  const now = new Date();
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), parseInt(hStr ?? '0', 10), parseInt(mStr ?? '0', 10)),
  );
  return { hour: utc.getHours(), minute: utc.getMinutes() };
}

/** "7:30 PM"-style label for a stored UTC time, in local time. */
export function formatUtcTimetzLocal(timetz: string): string {
  const { hour, minute } = utcTimetzToLocal(timetz);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
