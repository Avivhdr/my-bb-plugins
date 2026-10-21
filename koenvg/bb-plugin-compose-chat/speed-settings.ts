import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";

/** User-approved preset; only effect selection and electric motion are settings. */
export const speedPreset = {
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
} as const;

export const lightSpeedPreset = {
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
} as const;

export const speedSettings = {
  speedBorder: {
    type: "select",
    label: "Speed border effect",
    description:
      "Glow is idle-free. Electric renders continuously while a visible composer uses Fast or Ultrafast. Choose Glow or Off if CPU/GPU usage rises.",
    options: ["Glow", "Electric", "Off"],
    default: "Glow",
  },
  electricMotion: {
    type: "boolean",
    label: "Animate Electric border",
    description: "15 fps maximum. Hidden composers and reduced-motion preferences stop animation.",
    default: true,
  },
} satisfies PluginSettingDescriptors;

export type SpeedEffect = "Glow" | "Electric" | "Off";
export function readSpeedEffect(value: unknown): SpeedEffect {
  if (value === undefined) return "Glow";
  return value === "Glow" || value === "Electric" ? value : "Off";
}
