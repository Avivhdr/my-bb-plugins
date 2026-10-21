import "./running-glyph.css";

// Clockwise outside-in, matching React Bits' 3×3 spiral lattice.
const SPIRAL = [0, 1, 2, 7, 8, 3, 6, 5, 4];

export function RunningGlyph() {
  return (
    <svg
      data-running-glyph=""
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      className="size-3 shrink-0"
    >
      {SPIRAL.map((step, index) => (
        <rect
          key={index}
          className="bb-thread-lattice-cell"
          x={(index % 3) * 6}
          y={Math.floor(index / 3) * 6}
          width="4"
          height="4"
          rx="1"
          fill="currentColor"
          style={{ animationDelay: `${step * 108 - 972}ms` }}
        />
      ))}
    </svg>
  );
}
