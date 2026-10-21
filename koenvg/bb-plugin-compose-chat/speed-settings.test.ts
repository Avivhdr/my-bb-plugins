import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import server from "./server.js";
import { readSpeedEffect, lightSpeedPreset, speedPreset } from "./speed-settings.js";

describe("Live speed-border settings", () => {
  it("declares a host-rendered selector and opt-in Electric choice", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "compose-chat" });
    server(bb);
    expect(harness.registrations.settingsDescriptors.speedBorder).toMatchObject({
      type: "select",
      options: ["Glow", "Electric", "Off"],
      default: "Glow",
    });
    expect(harness.registrations.settingsDescriptors.electricMotion).toMatchObject({
      type: "boolean",
      default: true,
    });
    await harness.behavior.setSettings({ speedBorder: "Electric", electricMotion: false });
    await expect(harness.behavior.setSettings({ speedBorder: "broken" })).rejects.toThrow();
    await harness.lifecycle.dispose();
  });
  it("copies the light-mode preset without changing the dark preset", () => {
    expect(lightSpeedPreset).toEqual({
      fastColor: "#7fc9df",
      ultraColor: "#96d3e5",
      glowColor: "#7fc9df",
      speed: 1,
      chaos: 0.14,
      thickness: 0.8,
      intensity: 0.6,
      glow: 0.4,
      arcs: 1.5,
      fps: 15,
      glowIntensity: 0.6,
      glowRadius: 32,
    });
  });
  it("copies the approved colors and parameters without reading draft data", () => {
    expect(speedPreset).toEqual({
      fastColor: "#c8a260",
      ultraColor: "#e4ba6d",
      glowColor: "#d6ad68",
      speed: 1,
      chaos: 0.08,
      thickness: 1,
      intensity: 0.4,
      glow: 0.25,
      arcs: 2,
      fps: 15,
      glowIntensity: 0.6,
      glowRadius: 32,
    });
  });
  it("uses Glow by default and rejects malformed persisted choices safely", () => {
    expect(readSpeedEffect(undefined)).toBe("Glow");
    expect(readSpeedEffect("Electric")).toBe("Electric");
    for (const value of ["Off", "", "broken", true, 9, null, {}])
      expect(readSpeedEffect(value)).toBe("Off");
  });
});
