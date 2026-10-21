import type { BbPluginApi } from "@get-bb/plugin-sdk";

// The palette lives in the manifest's bb.themes entry. bb requires a server
// entry, so this one does nothing.
export default async function plugin(_bb: BbPluginApi) {}
