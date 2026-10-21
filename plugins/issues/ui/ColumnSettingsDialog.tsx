import { useState } from "react";
import type { LabelUsage } from "../core/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ColorGrid, SectionLabel, swatchStyle } from "./bits";

function SwatchButton({
  name,
  color,
  disabled,
  onPick,
}: {
  name: string;
  color: string | null;
  disabled: boolean;
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="size-3.5 shrink-0 rounded-md border border-foreground/20 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          style={swatchStyle(color)}
          aria-label={`Change color of ${name}`}
          title={`Change "${name}" color`}
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" mobileTitle={`${name} color`}>
        <ColorGrid
          current={color}
          onPick={(next) => {
            setOpen(false);
            onPick(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Pick which labels become columns, and in what order. */
export function ColumnSettingsDialog({
  repo,
  labels,
  initialColumnLabels,
  busy,
  error,
  onClose,
  onSave,
  onRecolor,
}: {
  repo: string;
  labels: LabelUsage[];
  initialColumnLabels: string[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (labels: string[]) => void;
  onRecolor: (name: string, color: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(() => [...initialColumnLabels]);
  // Local copies so a color change shows at once and reverts if GitHub refuses it.
  const [editableLabels, setEditableLabels] = useState<LabelUsage[]>(() => labels.map((l) => ({ ...l })));
  const [colorBusy, setColorBusy] = useState<string | null>(null);

  const available = editableLabels.filter((label) => !selected.includes(label.name));
  const colorOf = (name: string) => editableLabels.find((label) => label.name === name)?.color ?? null;

  function move(i: number, direction: -1 | 1) {
    const j = i + direction;
    if (j < 0 || j >= selected.length) return;
    const next = selected.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSelected(next);
  }

  async function recolor(name: string, color: string) {
    setColorBusy(name);
    const previous = editableLabels;
    setEditableLabels(previous.map((label) => (label.name === name ? { ...label, color } : label)));
    try {
      await onRecolor(name, color);
    } catch {
      setEditableLabels(previous);
    } finally {
      setColorBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-base">Columns for {repo}</DialogTitle>
          <DialogDescription>
            Active columns appear in this order, then "No label / Other". Use the arrows to reorder.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="flex flex-col gap-2">
            <SectionLabel>Active columns</SectionLabel>
            {selected.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No columns yet. Add some below.</p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {selected.map((name, i) => (
                <div key={name} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                  <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <SwatchButton
                    name={name}
                    color={colorOf(name)}
                    disabled={busy || colorBusy !== null}
                    onPick={(color) => void recolor(name, color)}
                  />
                  <span className="flex-1 truncate text-sm">{name}</span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={i === 0}
                      aria-label={`Move ${name} up`}
                      onClick={() => move(i, -1)}
                    >
                      <Icon name="ChevronUp" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={i === selected.length - 1}
                      aria-label={`Move ${name} down`}
                      onClick={() => move(i, 1)}
                    >
                      <Icon name="ChevronDown" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      aria-label={`Remove ${name}`}
                      onClick={() => setSelected(selected.filter((x) => x !== name))}
                    >
                      <Icon name="X" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {available.length > 0 ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>Add a column</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {available.map((label) => (
                  <button
                    key={label.name}
                    type="button"
                    title={label.used ? undefined : "No open issue carries this label"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-state-hover",
                      !label.used && "opacity-60",
                    )}
                    onClick={() => setSelected([...selected, label.name])}
                  >
                    <span className="size-2.5 rounded-sm" style={swatchStyle(label.color)} />
                    <Icon name="Plus" className="size-3" />
                    {label.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onSave(selected)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
