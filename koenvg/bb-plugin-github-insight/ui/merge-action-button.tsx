import { useState, type ComponentProps, type ReactNode } from "react";
import {
  MERGE_METHOD_LABEL,
  type MergeMethod,
  type RunnableMergeAction,
} from "../core/merge-action";
import type { PrInsight } from "../core/overview";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { PR_ACTION_BUSY_LABEL } from "./pr-operations";
import type { PrAction } from "../contract";
import { usePrActionButton } from "./use-pr-action";

type ButtonSize = "default" | "compact";

const MERGE_ACTIONS: ReadonlySet<PrAction> = new Set(["merge", "enqueue"]);

const BUTTON_CLASS =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60";
const SIZE_CLASS: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-3 text-sm",
  compact: "h-6 gap-1 px-2 text-xs",
};
const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  default: "size-4",
  compact: "size-3.5",
};
const PRIMARY_CLASS = cn(BUTTON_CLASS, "bg-foreground text-background hover:bg-foreground/90");

interface MergeActionButtonProps {
  threadId: string;
  pr: PrInsight["pr"];
  action: RunnableMergeAction;
  size?: ButtonSize;
  disabled?: boolean;
  showError?: boolean;
}

export function MergeActionButton({
  threadId,
  pr,
  action,
  size = "default",
  disabled = false,
  showError = true,
}: MergeActionButtonProps) {
  const { busy, ownRunning, ownError, run } = usePrActionButton(
    threadId,
    pr.headOid,
    MERGE_ACTIONS,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const running = ownRunning !== null;
  const busyLabel = ownRunning ? PR_ACTION_BUSY_LABEL[ownRunning] : "Merging…";
  const runAction = () => void run({ action: action.kind, expectedHeadOid: pr.headOid });
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-start gap-1">
      {action.kind === "enqueue" ? (
        <ActionButton
          icon="ListEnd"
          label="Enqueue"
          busyLabel={busyLabel}
          running={running}
          disabled={disabled || busy}
          size={size}
          onClick={runAction}
        />
      ) : (
        <MergeConfirmation
          pr={pr}
          method={action.method}
          running={busy}
          trigger={
            <ActionButton
              icon="GitMerge"
              label={MERGE_METHOD_LABEL[action.method]}
              busyLabel={busyLabel}
              running={running}
              disabled={disabled || busy}
              size={size}
            />
          }
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          confirm={runAction}
        />
      )}
      {showError && ownError !== null && (
        <p role="alert" className="break-words text-xs text-destructive">
          {ownError}
        </p>
      )}
    </div>
  );
}

interface ActionButtonProps extends Omit<ComponentProps<"button">, "children"> {
  icon: IconName;
  label: string;
  busyLabel: string;
  running: boolean;
  size: ButtonSize;
}

function ActionButton({ icon, label, busyLabel, running, size, ...rest }: ActionButtonProps) {
  return (
    <button
      type="button"
      className={cn(PRIMARY_CLASS, SIZE_CLASS[size])}
      disabled={running}
      {...rest}
    >
      <Icon
        name={running ? "Spinner" : icon}
        className={cn(ICON_SIZE_CLASS[size], running && "animate-spin motion-reduce:animate-none")}
      />
      {running ? busyLabel : label}
    </button>
  );
}

interface MergeConfirmationProps {
  pr: PrInsight["pr"];
  method: MergeMethod;
  running: boolean;
  trigger?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirm: () => void;
}

export function MergeConfirmation({
  pr,
  method,
  running,
  trigger,
  open,
  onOpenChange,
  confirm,
}: MergeConfirmationProps) {
  const label = MERGE_METHOD_LABEL[method];
  return (
    <ConfirmDialog
      title={`Merge pull request #${pr.number}?`}
      description={
        <>
          <span className="break-words text-foreground">{pr.title}</span>
          <span>Method: {label}</span>
        </>
      }
      confirmLabel={label}
      running={running}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      confirm={confirm}
    />
  );
}
