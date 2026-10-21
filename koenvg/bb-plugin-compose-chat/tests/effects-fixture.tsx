import { createRoot } from "react-dom/client";
import appDefinition from "../app.js";
import { SpeedBorders } from "../speed-effects.js";
import { readSpeedEffect } from "../speed-settings.js";
export default appDefinition;

/** The fixture uses the real decorator; only the SDK settings delivery is fake. */
export function mountSpeedBorders() {
  const node = document.createElement("div");
  node.dataset.composeSpeedOwned = "";
  document.body.append(node);
  const root = createRoot(node);
  const set = (value: unknown = "Glow", motion = true) =>
    root.render(<SpeedBorders effect={readSpeedEffect(value)} motion={motion} />);
  set();
  return {
    set,
    dispose: () => {
      root.unmount();
      node.remove();
    },
  };
}
