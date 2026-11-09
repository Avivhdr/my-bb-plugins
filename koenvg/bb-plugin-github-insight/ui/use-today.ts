import { useEffect, useState } from "react";
import { localDay, msUntilMidnight } from "../core/working-day";

/** The current local day, `YYYY-MM-DD`. Re-renders at midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => localDay(Date.now()));
  useEffect(() => {
    // A little past midnight, so the new day has begun when it fires.
    const timer = setTimeout(
      () => setToday(localDay(Date.now())),
      msUntilMidnight(Date.now()) + 1_000,
    );
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}
