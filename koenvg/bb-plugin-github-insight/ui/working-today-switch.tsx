import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { isWorkingDay } from "../core/working-day";
import { cn } from "@/lib/utils";
import { messageOf } from "./error-message";
import { useToday } from "./use-today";

/**
 * "Working today": auto-review starts and sends nothing until you switch it on. It reads as off
 * again from midnight, so each working day starts with it off.
 */
export function WorkingTodaySwitch({ workingDay }: { workingDay: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  useToday();
  const working = isWorkingDay(workingDay, Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setSaving(true);
    setError(null);
    try {
      const result = await rpc.call("setWorkingToday", { working: next });
      if (result.kind === "error") setError(result.message);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label
      title={
        error ??
        (working
          ? "Auto-review starts and sends reviews until midnight."
          : "Auto-review is paused. Switch on to let it start reviews today. It switches off at midnight.")
      }
      className={cn(
        "flex cursor-pointer select-none items-center gap-1.5 rounded-full px-2 py-1 text-xs",
        working ? "text-muted-foreground" : "bg-neutral-700/10 font-medium text-foreground",
        error !== null && "text-destructive",
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={working}
        disabled={saving}
        onChange={(event) => void set(event.target.checked)}
      />
      <span
        aria-hidden
        className="relative h-4 w-7 shrink-0 rounded-full bg-muted-foreground/25 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-3 after:rounded-full after:bg-background after:shadow-[0_1px_2px_rgb(0_0_0/0.2)] after:transition-transform after:duration-200 after:ease-out peer-checked:bg-primary peer-checked:after:translate-x-3 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
      />
      Working today
    </label>
  );
}
