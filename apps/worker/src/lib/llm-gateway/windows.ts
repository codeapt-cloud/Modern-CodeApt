/** Rolling-window helpers (worker copy of the API's). Pure over `now`. */
export function minuteWindowStart(now: number): number {
  return Math.floor(now / 60_000) * 60_000;
}

export function utcDayWindowStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}
