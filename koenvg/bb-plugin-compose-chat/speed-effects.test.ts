// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import appDefinition from "./app.js";

const components = vi.hoisted(() => ({ electric: vi.fn(), glow: vi.fn() }));
vi.mock("./effects/react-bits/ElectricBorder.js", () => ({
  default: (props: Record<string, unknown>) => {
    components.electric(props);
    return null;
  },
}));
vi.mock("./effects/react-bits/BorderGlow.js", () => ({
  default: (props: Record<string, unknown>) => {
    components.glow(props);
    return null;
  },
}));

beforeEach(() => {
  components.electric.mockClear();
  components.glow.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  document.documentElement.dataset.theme = "dark";
});
afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe("SDK settings delivery to native speed decorations", () => {
  for (const theme of ["dark", "light"])
    for (const mode of ["Fast", "Ultrafast"])
      for (const effect of ["Glow", "Electric"]) {
        it(`delivers ${effect} settings and the approved preview mapping for ${mode} in ${theme}`, async () => {
          document.documentElement.dataset.theme = theme;
          document.body.innerHTML = `<div data-app-composer><div data-follow-up-composer><form data-promptbox>
        <textarea>Preserve this draft</textarea>
        <button aria-label="Provider, model and reasoning"><span title="Codex (${mode} mode)">Model</span></button>
      </form></div></div>`;
          const frame = document.querySelector<HTMLElement>("[data-follow-up-composer]")!;
          frame.getBoundingClientRect = () => new DOMRect(20, 20, 700, 250);
          const input = document.querySelector("textarea")!;
          const app = await loadPluginApp(appDefinition);
          const scripts = await mountPluginContentScripts(app, { pluginId: "compose-chat" });
          const slot = renderSlot(
            app.appOverlays[0]!,
            {},
            { settings: { speedBorder: effect, electricMotion: false } },
          );
          try {
            const spy = effect === "Electric" ? components.electric : components.glow;
            await waitFor(() => expect(spy).toHaveBeenCalled());
            const props = spy.mock.lastCall![0];
            const factor = mode === "Fast" ? 0.75 : 1;
            const color =
              theme === "light"
                ? mode === "Fast"
                  ? "#7fc9df"
                  : "#96d3e5"
                : mode === "Fast"
                  ? "#c8a260"
                  : "#e4ba6d";
            if (effect === "Electric") {
              expect(props).toMatchObject({
                color,
                glowColor: theme === "light" ? "#7fc9df" : "#d6ad68",
                chaos: theme === "light" ? 0.14 : 0.08,
                thickness: theme === "light" ? 0.8 : 1,
                glow: theme === "light" ? 0.4 : 0.25,
                maxFps: 15,
                paused: true,
                interactive: false,
                intro: false,
                flicker: 0,
              });
              expect(props.speed).toBeCloseTo(factor, 10);
              expect(props.intensity).toBeCloseTo((theme === "light" ? 0.6 : 0.4) * factor, 10);
              expect(props.arcs).toBeCloseTo((theme === "light" ? 1.5 : 2) * factor, 10);
            } else {
              expect(props).toMatchObject({
                glowRadius: 32,
                animated: false,
                fillOpacity: 0,
                backgroundColor: "transparent",
              });
              expect(props.glowColor).toBe(
                theme === "light" ? "193.75 60 68.627451" : "37.636364 57.291667 62.352941",
              );
              expect(props.glowIntensity).toBeCloseTo(0.6 * factor, 10);
              expect((props.colors as string[])[0]).toBe(color);
            }
            document.documentElement.dataset.theme = theme === "light" ? "dark" : "light";
            const switchedColor =
              theme === "light"
                ? mode === "Fast"
                  ? "#c8a260"
                  : "#e4ba6d"
                : mode === "Fast"
                  ? "#7fc9df"
                  : "#96d3e5";
            await waitFor(() =>
              expect(
                effect === "Electric"
                  ? spy.mock.lastCall![0].color
                  : spy.mock.lastCall![0].colors[0],
              ).toBe(switchedColor),
            );
            expect(document.querySelector("textarea")).toBe(input);
            expect(input.value).toBe("Preserve this draft");
          } finally {
            slot.lifecycle.unmount();
            await scripts.lifecycle.dispose();
          }
          expect(document.querySelector(".compose-speed-layer")).toBeNull();
        });
      }
  it("honors Off from the SDK settings hook", async () => {
    document.body.innerHTML =
      '<div data-app-composer><div data-follow-up-composer><form data-promptbox><button aria-label="Provider, model and reasoning"><span title="Codex (Ultrafast mode)">Model</span></button></form></div></div>';
    document.querySelector<HTMLElement>("[data-follow-up-composer]")!.getBoundingClientRect = () =>
      new DOMRect(20, 20, 700, 250);
    const app = await loadPluginApp(appDefinition);
    const scripts = await mountPluginContentScripts(app, { pluginId: "compose-chat" });
    const slot = renderSlot(app.appOverlays[0]!, {}, { settings: { speedBorder: "Off" } });
    expect(components.electric).not.toHaveBeenCalled();
    expect(components.glow).not.toHaveBeenCalled();
    expect(document.querySelector(".compose-speed-layer")).toBeNull();
    slot.lifecycle.unmount();
    await scripts.lifecycle.dispose();
  });
});
