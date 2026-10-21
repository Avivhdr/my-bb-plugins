import type { ReactNode } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";

const BUTTON_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  running: boolean;
  trigger?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  running,
  trigger,
  open,
  onOpenChange,
  confirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-background p-6 shadow-sm">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="flex flex-col gap-1 text-sm text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel
              className={cn(BUTTON_CLASS, "border border-input hover:bg-state-hover")}
            >
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className={cn(BUTTON_CLASS, "bg-foreground text-background hover:bg-foreground/90")}
              onClick={confirm}
              disabled={running}
            >
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
