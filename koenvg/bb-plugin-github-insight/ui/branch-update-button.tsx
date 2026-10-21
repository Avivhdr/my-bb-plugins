import { useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { LocalCommitsAhead, PrAction, rpcContract } from "../contract";
import { countOf } from "../core/blockers";
import type { PrInsight } from "../core/overview";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { SECONDARY_BUTTON } from "./controls";
import { PR_ACTION_BUSY_LABEL } from "./pr-operations";
import { usePrActionButton } from "./use-pr-action";

const UPDATE_ACTIONS: ReadonlySet<PrAction> = new Set(["update-merge", "update-rebase"]);

type LocalCommitsCheck = { kind: "checking" } | LocalCommitsAhead;

function rebaseBlocker(check: LocalCommitsCheck): string | null {
  if (check.kind === "checking") return "Checking local commits…";
  if (check.kind === "unknown") return "Cannot check local commits";
  if (check.count > 0) return `${countOf(check.count, "unpushed commit")}. Push first.`;
  return null;
}

interface BranchUpdateButtonProps {
  threadId: string;
  pr: PrInsight["pr"];
  onUpdated: () => void;
}

export function BranchUpdateButton({ threadId, pr, onUpdated }: BranchUpdateButtonProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { busy, ownRunning, ownError, run } = usePrActionButton(
    threadId,
    pr.headOid,
    UPDATE_ACTIONS,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localCommits, setLocalCommits] = useState<LocalCommitsCheck>({ kind: "checking" });
  const latestCheck = useRef(0);

  async function update(action: "update-merge" | "update-rebase") {
    const result = await run({ action, expectedHeadOid: pr.headOid });
    if (result?.kind === "ok") onUpdated();
  }

  async function toggleMenu() {
    const opening = !menuOpen;
    setMenuOpen(opening);
    if (!opening) return;
    const check = ++latestCheck.current;
    setLocalCommits({ kind: "checking" });
    const result = await rpc
      .call("localCommitsAhead", { threadId })
      .catch((): LocalCommitsAhead => ({ kind: "unknown" }));
    if (check === latestCheck.current) setLocalCommits(result);
  }

  const blocker = rebaseBlocker(localCommits);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex items-center">
        <button
          type="button"
          className={cn(SECONDARY_BUTTON, "rounded-r-none")}
          disabled={busy}
          onClick={() => void update("update-merge")}
        >
          <Icon
            name={ownRunning ? "Spinner" : "GitBranch"}
            className={cn("size-3.5", ownRunning && "animate-spin motion-reduce:animate-none")}
          />
          {ownRunning ? PR_ACTION_BUSY_LABEL[ownRunning] : "Update branch"}
        </button>
        <button
          type="button"
          aria-label="More update options"
          aria-expanded={menuOpen}
          className={cn(SECONDARY_BUTTON, "-ml-px rounded-l-none px-1.5")}
          disabled={busy}
          onClick={() => void toggleMenu()}
        >
          <Icon name={menuOpen ? "ChevronUp" : "ChevronDown"} className="size-3.5" />
        </button>
      </div>
      {menuOpen && (
        <div className="flex flex-col items-start gap-0.5 pl-1">
          <ConfirmDialog
            title={`Rebase the branch of pull request #${pr.number}?`}
            description={
              <>
                <span className="break-words text-foreground">{pr.title}</span>
                <span>
                  The thread's local branch will no longer match the remote branch. Pull with rebase
                  before the next push.
                </span>
              </>
            }
            confirmLabel="Update with rebase"
            running={busy}
            trigger={
              <button
                type="button"
                className="text-xs underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
                disabled={busy || blocker !== null}
              >
                Update with rebase…
              </button>
            }
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            confirm={() => void update("update-rebase")}
          />
          {blocker !== null && <p className="text-xs text-muted-foreground">{blocker}</p>}
        </div>
      )}
      {ownError !== null && (
        <p role="alert" className="break-words text-xs text-destructive">
          {ownError}
        </p>
      )}
    </div>
  );
}

export function PullReminder({ dismiss }: { dismiss: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
    >
      <Icon name="Info" className="size-4 shrink-0 text-muted-foreground" />
      <span>Branch updated on GitHub. Pull before you push.</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="ml-auto rounded-sm text-muted-foreground hover:text-foreground"
        onClick={dismiss}
      >
        <Icon name="X" className="size-3.5" />
      </button>
    </div>
  );
}
