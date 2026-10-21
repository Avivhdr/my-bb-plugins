import { useEffect, useId, useState, type ButtonHTMLAttributes, type Ref } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import FloppyDiskIcon from "@hugeicons/core-free-icons/FloppyDiskIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";

type IconActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: "Edit" | "Eye" | "Save" | "RotateCcw" | "Info" | "On" | "Off";
  label: string;
  tooltip?: string;
  ref?: Ref<HTMLButtonElement>;
};

/** Named icon control with a keyboard-dismissible hover/focus tooltip. */
export function IconAction({ icon, label, tooltip = label, ref, ...props }: IconActionProps) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showTooltip = (hovered || focused) && !dismissed;
  useEffect(() => {
    if (!showTooltip) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDismissed(true);
        // A visible modal label consumes Escape before the native dialog dismissal.
        if (event.target instanceof Element && event.target.closest("dialog[open]"))
          event.preventDefault();
      }
    };
    // Hover labels must also be dismissible when keyboard focus is elsewhere.
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [showTooltip]);
  return (
    <span
      className="cleanup-icon-action"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        {...props}
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={showTooltip ? id : undefined}
        onFocus={(event) => {
          setFocused(true);
          setDismissed(false);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && showTooltip) {
            setDismissed(true);
            event.preventDefault();
            event.stopPropagation();
          }
          props.onKeyDown?.(event);
        }}
      >
        {icon === "On" || icon === "Off" ? (
          <span className="cleanup-state-icon" aria-hidden="true">
            <HugeiconsIcon
              icon={Tick02Icon}
              className="cleanup-icon"
              aria-hidden="true"
              data-icon="On"
              data-active={icon === "On"}
            />
            <HugeiconsIcon
              icon={Cancel01Icon}
              className="cleanup-icon"
              aria-hidden="true"
              data-icon="Off"
              data-active={icon === "Off"}
            />
          </span>
        ) : icon === "Save" ? (
          <HugeiconsIcon
            icon={FloppyDiskIcon}
            className="cleanup-icon"
            aria-hidden="true"
            data-icon="Save"
          />
        ) : (
          <Icon name={icon} className="cleanup-icon" aria-hidden="true" />
        )}
      </button>
      {showTooltip && (
        <span id={id} role="tooltip" className="cleanup-tooltip">
          {tooltip}
        </span>
      )}
    </span>
  );
}
