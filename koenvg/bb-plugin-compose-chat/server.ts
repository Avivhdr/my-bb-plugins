import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { speedSettings } from "./speed-settings.js";

export default function composeChat(bb: BbPluginApi): void {
  bb.settings.define(speedSettings);
}
