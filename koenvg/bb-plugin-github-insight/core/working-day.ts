/** The local calendar day of `ms`, as `YYYY-MM-DD`. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whether "Working today" was switched on today. It reads as off from the next midnight. */
export function isWorkingDay(workingDay: string | null, now: number): boolean {
  return workingDay !== null && workingDay === localDay(now);
}

/** Milliseconds from `now` to the next local midnight. */
export function msUntilMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now;
}

/** Auto-review is on but waits, because "Working today" is off for the current day. */
export function waitsForWorkingDay(
  view: { autoReviewOn: boolean; workingDay: string | null },
  now: number,
): boolean {
  return view.autoReviewOn && !isWorkingDay(view.workingDay, now);
}
