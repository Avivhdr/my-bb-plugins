import type { BbPluginApi } from "@get-bb/plugin-sdk";

// The button lives in app.tsx. bb requires a server entry, so this one does nothing.
export default async function plugin(_bb: BbPluginApi) {}
