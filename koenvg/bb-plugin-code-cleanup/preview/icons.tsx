import { HugeiconsIcon } from "@hugeicons/react";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import type { ExperimentalIconProps } from "@get-bb/plugin-sdk/app";

const icons = {
  Edit: Edit02Icon,
  Eye: ViewIcon,
  RotateCcw: Refresh01Icon,
  Info: InformationCircleIcon,
};
export function FixtureIcon({ name, fallback: _fallback, ...props }: ExperimentalIconProps) {
  const icon = icons[name as keyof typeof icons];
  if (!icon) throw new Error(`Unknown fixture icon: ${name}`);
  return <HugeiconsIcon icon={icon} {...props} data-icon={name} />;
}
