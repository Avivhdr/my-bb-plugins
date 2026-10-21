import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SidebarSpend } from "./src/ui/SidebarSpend";
import { SpendDashboard } from "./src/ui/SpendDashboard";
import { ThreadSpend } from "./src/ui/ThreadSpend";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "claude-usage",
    title: "Claude usage",
    icon: "ChartColumn",
    path: "claude-usage",
    component: SpendDashboard,
    experimental_sidebarAccessory: SidebarSpend,
  });
  app.slots.experimental_threadHeaderAction({
    id: "thread-spend",
    title: "Claude Code spend",
    component: ThreadSpend,
  });
});
