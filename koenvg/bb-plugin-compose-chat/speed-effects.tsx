import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "@get-bb/plugin-sdk/app";
import ElectricBorder from "./effects/react-bits/ElectricBorder.js";
import BorderGlow from "./effects/react-bits/BorderGlow.js";
import { reactBitsNotice } from "./react-bits-notice.js";
import {
  readSpeedEffect,
  lightSpeedPreset,
  speedPreset,
  type SpeedEffect,
} from "./speed-settings.js";
import {
  observeSpeedTargets,
  speedLayerMargin as margin,
  type SpeedTarget,
} from "./speed-targets.js";

// Exact HSL conversions of the approved dark/light glow hex colors.
const glowHslByTheme = {
  dark: "37.636364 57.291667 62.352941",
  light: "193.75 60 68.627451",
} as const;

function SpeedBorder({
  target,
  effect,
  motion,
}: {
  target: SpeedTarget;
  effect: SpeedEffect;
  motion: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const preset = target.theme === "light" ? lightSpeedPreset : speedPreset;
  const glowHsl = glowHslByTheme[target.theme];
  // The approved preview controls set Ultrafast; Fast uses its quieter 75% mapping.
  const factor = target.mode === "Ultrafast" ? 1 : 0.75;
  const angle = target.mode === "Ultrafast" ? target.cornerAngle : 45;
  useEffect(() => {
    if (effect !== "Glow" || !target.visible) return;
    const card = ref.current?.querySelector<HTMLElement>(".border-glow-card");
    if (!card) return;
    let raf = 0;
    let point: { x: number; y: number } | undefined;
    const reset = () => {
      card.style.setProperty("--edge-proximity", "100");
      card.style.setProperty("--cursor-angle", `${angle}deg`);
    };
    const paint = () => {
      raf = 0;
      if (!point) {
        reset();
        return;
      }
      const dx = point.x - target.left - target.width / 2;
      const dy = point.y - target.top - target.height / 2;
      const proximity = Math.min(
        1,
        Math.max(Math.abs(dx) / (target.width / 2), Math.abs(dy) / (target.height / 2)),
      );
      card.style.setProperty("--edge-proximity", `${proximity * 100}`);
      card.style.setProperty("--cursor-angle", `${(Math.atan2(dy, dx) * 180) / Math.PI + 90}deg`);
    };
    const move = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY };
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => {
      point = undefined;
      cancelAnimationFrame(raf);
      raf = 0;
      reset();
    };
    reset();
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [target, angle, effect]);

  const color = target.mode === "Ultrafast" ? preset.ultraColor : preset.fastColor;
  const style: CSSProperties = {
    left: target.left - margin,
    top: target.top - margin,
    width: target.width + margin * 2,
    height: target.height + margin * 2,
    clipPath: target.clip,
    visibility: target.visible ? "visible" : "hidden",
  };
  return (
    <div
      ref={ref}
      data-compose-speed-owned=""
      className="compose-speed-layer"
      aria-hidden="true"
      data-react-bits-notice={reactBitsNotice}
      data-effect={effect}
      data-speed={target.mode}
      data-theme={target.theme}
      style={style}
    >
      <div
        className="compose-speed-frame"
        style={
          {
            left: margin,
            top: margin,
            width: target.width,
            height: target.height,
            "--compose-corner-angle": `${angle}deg`,
            "--compose-speed-color": color,
          } as CSSProperties
        }
      >
        {effect === "Electric" ? (
          <ElectricBorder
            color={color}
            glowColor={preset.glowColor}
            speed={preset.speed * factor}
            chaos={preset.chaos}
            thickness={preset.thickness}
            intensity={preset.intensity * factor}
            glow={preset.glow}
            arcs={preset.arcs * factor}
            maxFps={preset.fps}
            paused={!motion || !target.visible}
            strands={1}
            spread={0.1}
            flicker={0}
            interactive={false}
            intro={false}
            borderRadius={target.radius}
            theme={target.theme}
          >
            <div className="compose-speed-fill" />
          </ElectricBorder>
        ) : (
          <BorderGlow
            className={`compose-speed-glow sweep-active${target.mode === "Ultrafast" ? " compose-speed-glow--opposite" : ""}`}
            glowColor={glowHsl}
            glowIntensity={preset.glowIntensity * factor}
            glowRadius={preset.glowRadius}
            colors={[
              color,
              `color-mix(in srgb, ${color} 70%, white)`,
              `color-mix(in srgb, ${color} 88%, white)`,
            ]}
            fillOpacity={0}
            animated={false}
            borderRadius={target.radius}
            backgroundColor="transparent"
          >
            <div className="compose-speed-fill" />
          </BorderGlow>
        )}
      </div>
    </div>
  );
}

/** SDK-owned additive decoration; the native composer is never rendered here. */
export function SpeedBorders({ effect, motion = true }: { effect: SpeedEffect; motion?: boolean }) {
  const [targets, setTargets] = useState<SpeedTarget[]>([]);
  useEffect(() => {
    if (effect === "Off") {
      setTargets([]);
      return;
    }
    return observeSpeedTargets(setTargets);
  }, [effect]);
  if (effect === "Off") return null;
  return createPortal(
    targets.map((target) => (
      <SpeedBorder key={`${effect}-${target.id}`} target={target} effect={effect} motion={motion} />
    )),
    document.body,
  );
}

export function SpeedBorderAppOverlay() {
  const { values, isLoading } = useSettings();
  return (
    <SpeedBorders
      effect={isLoading ? "Off" : readSpeedEffect(values?.speedBorder)}
      motion={values?.electricMotion === undefined ? true : values.electricMotion === true}
    />
  );
}
