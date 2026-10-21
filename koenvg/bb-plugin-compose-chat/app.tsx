import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountStyles } from "./styles-lifecycle.js";
import { createVoiceKeyboardControls } from "./voice-keyboard.js";
import { SpeedBorderAppOverlay } from "./speed-effects.js";
import "./app.css";
import "./motion.css";
import "./speed.css";

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "chat-styles", mount: mountStyles });
  app.slots.experimental_appOverlay({ id: "speed-borders", component: SpeedBorderAppOverlay });
  const voice = createVoiceKeyboardControls();
  app.contentScripts.register({ id: "voice-keyboard", mount: voice.mount });
  app.commands.register({
    id: "start-voice-input",
    title: "Start voice input",
    defaultShortcut: { key: "Space", control: true, shift: true },
    isAvailable: voice.canStart,
    run: voice.start,
  });
});
