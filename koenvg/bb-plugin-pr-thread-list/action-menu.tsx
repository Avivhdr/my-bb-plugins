import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const TOOL_BUTTON = `flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground ${FOCUS_RING}`;
const PANEL_WIDTH = 208;
const EDGE = 8;
const GAP = 4;

export interface MenuItem {
  label: string;
  run: () => void | Promise<unknown>;
  disabled?: boolean;
  checked?: boolean;
  section?: string;
  failure?: string;
}

/** Portals above the scrolling list, so menus at its lower edge stay visible. */
export function ActionMenu({
  label,
  items,
  icon = "⋯",
}: {
  label: string;
  items: readonly MenuItem[];
  icon?: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  }>({ left: 0, maxHeight: 0 });
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const scroll = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  const toggle = () => {
    if (!open && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - GAP - EDGE;
      const above = rect.top - GAP - EDGE;
      const left = Math.max(
        EDGE,
        Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - EDGE),
      );
      setPosition(
        below >= 240 || below >= above
          ? { top: rect.bottom + GAP, left, maxHeight: below }
          : { bottom: window.innerHeight - rect.top + GAP, left, maxHeight: above },
      );
    }
    setOpen(!open);
  };
  return (
    <span className="shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={TOOL_BUTTON}
        onClick={toggle}
      >
        {icon}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              role="menu"
              aria-label={label}
              className="fixed z-50 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
              style={{ ...position, width: PANEL_WIDTH }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
                );
                const next =
                  buttons.indexOf(document.activeElement as HTMLButtonElement) +
                  (event.key === "ArrowDown" ? 1 : -1);
                buttons[(next + buttons.length) % buttons.length]?.focus();
              }}
            >
              {sectionsOf(items).map(({ section, entries }, index) => (
                <div
                  key={section ?? index}
                  role="group"
                  aria-label={section}
                  className={index > 0 ? "-mx-1 mt-1 border-t border-border px-1 pt-1" : undefined}
                >
                  {section ? (
                    <div
                      aria-hidden
                      className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-muted-foreground"
                    >
                      {section}
                    </div>
                  ) : null}
                  {entries.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                      aria-checked={item.checked}
                      disabled={item.disabled}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-40"
                      onClick={() => {
                        setOpen(false);
                        trigger.current?.focus();
                        const failure = item.failure ?? `Could not ${item.label.toLowerCase()}.`;
                        try {
                          void Promise.resolve(item.run()).catch(() => toast.error(failure));
                        } catch {
                          toast.error(failure);
                        }
                      }}
                    >
                      {item.checked !== undefined ? (
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          {item.checked ? (
                            <Icon name="Check" className="size-3.5" aria-hidden />
                          ) : null}
                        </span>
                      ) : null}
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function sectionsOf(items: readonly MenuItem[]) {
  const sections: { section: string | undefined; entries: MenuItem[] }[] = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last && last.section === item.section) last.entries.push(item);
    else sections.push({ section: item.section, entries: [item] });
  }
  return sections;
}
