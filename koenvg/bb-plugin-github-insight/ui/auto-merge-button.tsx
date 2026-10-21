import type { PrAction } from "../contract";
import { AUTO_MERGE_METHOD_LABEL, type AutoMergeAction } from "../core/auto-merge";
import type { PrInsight } from "../core/overview";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { QUIET_BUTTON, SECONDARY_BUTTON } from "./controls";
import { PR_ACTION_BUSY_LABEL } from "./pr-operations";
import { usePrActionButton } from "./use-pr-action";

const AUTO_MERGE_ACTIONS: ReadonlySet<PrAction> = new Set([
  "enable-auto-merge",
  "disable-auto-merge",
]);

interface AutoMergeButtonProps {
  threadId: string;
  pr: PrInsight["pr"];
  action: Exclude<AutoMergeAction, { kind: "none" }>;
}

export function AutoMergeButton({ threadId, pr, action }: AutoMergeButtonProps) {
  const { busy, ownRunning, ownError, run } = usePrActionButton(
    threadId,
    pr.headOid,
    AUTO_MERGE_ACTIONS,
  );
  const enable = action.kind === "enable";
  const label = enable
    ? `Enable auto-merge (${AUTO_MERGE_METHOD_LABEL[action.method]})`
    : "Disable";
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        className={enable ? SECONDARY_BUTTON : cn(QUIET_BUTTON, "h-6 px-2 font-normal")}
        disabled={busy}
        onClick={() =>
          void run({
            action: enable ? "enable-auto-merge" : "disable-auto-merge",
            expectedHeadOid: pr.headOid,
          })
        }
      >
        {enable && (
          <Icon
            name={ownRunning ? "Spinner" : "GitMerge"}
            className={cn("size-3.5", ownRunning && "animate-spin motion-reduce:animate-none")}
          />
        )}
        {ownRunning ? PR_ACTION_BUSY_LABEL[ownRunning] : label}
      </button>
      {ownError !== null && (
        <p role="alert" className="break-words text-xs font-normal text-destructive">
          {ownError}
        </p>
      )}
    </div>
  );
}
