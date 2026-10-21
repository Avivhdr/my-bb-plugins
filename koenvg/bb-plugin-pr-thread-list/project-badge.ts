const PALETTE = [
  "#2563EB",
  "#7C3AED",
  "#C026D3",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#CA8A04",
  "#16A34A",
  "#059669",
  "#0891B2",
  "#0284C7",
  "#4F46E5",
] as const;

export interface ProjectBadge {
  background: string;
  foreground: "#000000" | "#FFFFFF";
  letter: string;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export function readableOn(background: string): ProjectBadge["foreground"] {
  const light = luminance(background);
  return (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? "#000000" : "#FFFFFF";
}

export function projectBadge(projectId: string, name: string): ProjectBadge {
  let hash = 0x811c9dc5;
  for (let index = 0; index < projectId.length; index += 1) {
    hash ^= projectId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const background = PALETTE[(hash >>> 0) % PALETTE.length]!;
  return {
    background,
    foreground: readableOn(background),
    letter: [...name.trim()][0]?.toLocaleUpperCase() ?? "?",
  };
}
