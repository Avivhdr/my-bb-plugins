import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ChangesTab } from "./ui/changes-tab";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "changes",
    title: "Changes",
    layout: "flush",
    component: ChangesTab,
  });
});
