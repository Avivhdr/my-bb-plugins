import { useEffect, useId, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { Button, type ButtonProps } from "./button";

type IconActionProps = Pick<ButtonProps, "onClick" | "aria-pressed"> & {
  icon: "Eye" | "Code" | "ListView" | "RotateCcw";
  label: string;
};

/** A named toolbar action with a hoverable, keyboard-dismissible hint. */
export function IconAction({ icon, label, ...props }: IconActionProps) {
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
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [showTooltip]);
  return (
    <span
      className="mr-icon-action"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <Button
        {...props}
        variant="ghost"
        size="icon"
        type="button"
        aria-label={label}
        aria-describedby={showTooltip ? id : undefined}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
      >
        <Icon name={icon} className="mr-icon" aria-hidden="true" />
      </Button>
      {showTooltip && (
        <span id={id} role="tooltip" className="mr-action-tooltip">
          {label}
        </span>
      )}
    </span>
  );
}
