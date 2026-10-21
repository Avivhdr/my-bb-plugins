import type { ReactNode } from "react";

export interface CollapseButtonProps {
  path: string;
  collapsed: boolean;
  onToggle: () => void;
  icons: { collapsed: ReactNode; expanded: ReactNode };
}

export function CollapseButton({ path, collapsed, onToggle, icons }: CollapseButtonProps) {
  return (
    <button
      type="button"
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${path}`}
      aria-expanded={!collapsed}
      className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onToggle}
    >
      {collapsed ? icons.collapsed : icons.expanded}
    </button>
  );
}

export interface ViewedCheckboxProps {
  path: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function ViewedCheckbox({ path, checked, disabled = false, onToggle }: ViewedCheckboxProps) {
  return (
    <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground has-[:disabled]:cursor-default has-[:disabled]:opacity-50">
      <input
        type="checkbox"
        aria-label={`Viewed ${path}`}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      Viewed
    </label>
  );
}
