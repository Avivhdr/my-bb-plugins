// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, mountPluginContentScripts } from "@get-bb/plugin-sdk/testing/app";
import appDefinition from "./app.js";
import { mountStyles } from "./styles-lifecycle.js";

const marker = "data-compose-chat";
afterEach(() => {
  document.documentElement.removeAttribute(marker);
  document.body.replaceChildren();
});

describe("Compose Chat's public content-script lifecycle", () => {
  it("registers style and voice owners without replacement UI or composer actions", async () => {
    const app = await loadPluginApp(appDefinition);
    expect(app.contentScripts).toHaveLength(2);
    expect(app.contentScripts[0]?.id).toBe("chat-styles");
    expect(app.navPanels).toHaveLength(0);
    expect(app.appOverlays).toHaveLength(1);
    expect(app.composerCustomizations).toHaveLength(0);
    expect(app.threadLists).toHaveLength(0);
    expect(app.timelineRenderers).toHaveLength(0);
  });

  it("activates only while mounted and removes the marker on disable", async () => {
    const app = await loadPluginApp(appDefinition);
    const mounted = await mountPluginContentScripts(app, { pluginId: "compose-chat" });
    expect(document.documentElement.hasAttribute(marker)).toBe(true);
    await mounted.lifecycle.dispose();
    expect(document.documentElement.hasAttribute(marker)).toBe(false);
    await mounted.lifecycle.dispose();
    expect(document.documentElement.hasAttribute(marker)).toBe(false);
  });

  it("leaves the existing input, controls, and event handlers untouched", async () => {
    document.body.innerHTML =
      '<form data-promptbox><textarea>Keep my draft</textarea><button type="button">Stop run</button></form>';
    const field = document.querySelector("textarea")!;
    const button = document.querySelector("button")!;
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });
    const original = document.body.innerHTML;
    const app = await loadPluginApp(appDefinition);
    const mounted = await mountPluginContentScripts(app, { pluginId: "compose-chat" });
    expect(document.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("Keep my draft");
    button.click();
    expect(clicks).toBe(1);
    await mounted.lifecycle.dispose();
    expect(document.body.innerHTML).toBe(original);
  });

  it("supports disable then remount without stale attributes", () => {
    const first = new AbortController();
    const cleanup = mountStyles({ signal: first.signal });
    first.abort();
    expect(document.documentElement.hasAttribute(marker)).toBe(false);
    const second = new AbortController();
    const cleanup2 = mountStyles({ signal: second.signal });
    cleanup();
    expect(document.documentElement.hasAttribute(marker)).toBe(true);
    cleanup2();
    expect(document.documentElement.hasAttribute(marker)).toBe(false);
  });

  it("does not activate a canceled mount", () => {
    const controller = new AbortController();
    controller.abort();
    mountStyles({ signal: controller.signal })();
    expect(document.documentElement.hasAttribute(marker)).toBe(false);
  });

  it("restores a preexisting marker and preserves later changes", () => {
    document.documentElement.setAttribute(marker, "previous");
    const cleanup = mountStyles({ signal: new AbortController().signal });
    cleanup();
    expect(document.documentElement.getAttribute(marker)).toBe("previous");
    const cleanup2 = mountStyles({ signal: new AbortController().signal });
    document.documentElement.setAttribute(marker, "changed-elsewhere");
    cleanup2();
    expect(document.documentElement.getAttribute(marker)).toBe("changed-elsewhere");
  });
  it("pauses motion in hidden documents and releases its visibility listener", () => {
    let visibility = "visible";
    const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    const motionMarker = "data-compose-chat-motion";
    document.documentElement.setAttribute(motionMarker, "previous");
    try {
      const controller = new AbortController();
      const cleanup = mountStyles({ signal: controller.signal });
      expect(document.documentElement.getAttribute(motionMarker)).toBe("running");
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(document.documentElement.getAttribute(motionMarker)).toBe("paused");
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(document.documentElement.getAttribute(motionMarker)).toBe("running");
      controller.abort();
      cleanup();
      expect(document.documentElement.getAttribute(motionMarker)).toBe("previous");
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(document.documentElement.getAttribute(motionMarker)).toBe("previous");
    } finally {
      document.documentElement.removeAttribute(motionMarker);
      if (original) Object.defineProperty(document, "visibilityState", original);
      else Reflect.deleteProperty(document, "visibilityState");
    }
  });
});
