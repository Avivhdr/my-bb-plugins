import { placeLabel, type CropPlan } from "./geometry";

export const OUTLINE_DARK = "#111111";
export const OUTLINE_LIGHT = "#ffffff";
const OUTLINE_WIDTH = 2;
const LABEL_FONT_SIZE = 14;
const LABEL_PADDING_X = 6;
const LABEL_HEIGHT = 22;
const LABEL_GAP = 4;

export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  "drawImage" | "strokeRect" | "fillRect" | "fillText" | "measureText"
> & {
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaseline;
};

export function drawAnnotation(
  ctx: DrawingContext,
  image: CanvasImageSource,
  plan: CropPlan,
  number: number,
) {
  const { source, box, scale } = plan;
  ctx.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    source.width,
    source.height,
  );

  const lineWidth = OUTLINE_WIDTH * scale;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = OUTLINE_DARK;
  ctx.strokeRect(
    box.x - lineWidth / 2,
    box.y - lineWidth / 2,
    box.width + lineWidth,
    box.height + lineWidth,
  );
  ctx.strokeStyle = OUTLINE_LIGHT;
  ctx.strokeRect(
    box.x - lineWidth * 1.5,
    box.y - lineWidth * 1.5,
    box.width + lineWidth * 3,
    box.height + lineWidth * 3,
  );

  const text = String(number);
  ctx.font = `bold ${LABEL_FONT_SIZE * scale}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const label = {
    width: ctx.measureText(text).width + 2 * LABEL_PADDING_X * scale,
    height: LABEL_HEIGHT * scale,
  };
  const outline = {
    x: box.x - 2 * lineWidth,
    y: box.y - 2 * lineWidth,
    width: box.width + 4 * lineWidth,
    height: box.height + 4 * lineWidth,
  };
  const at = placeLabel(outline, label, source, LABEL_GAP * scale);
  ctx.fillStyle = OUTLINE_LIGHT;
  ctx.fillRect(at.x - scale, at.y - scale, label.width + 2 * scale, label.height + 2 * scale);
  ctx.fillStyle = OUTLINE_DARK;
  ctx.fillRect(at.x, at.y, label.width, label.height);
  ctx.fillStyle = OUTLINE_LIGHT;
  ctx.fillText(text, at.x + LABEL_PADDING_X * scale, at.y + label.height / 2);
}

export async function renderAnnotatedJpeg(
  capture: { base64: string },
  plan: CropPlan,
  number: number,
): Promise<string> {
  const bytes = Uint8Array.from(atob(capture.base64), (char) => char.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  try {
    const canvas = new OffscreenCanvas(plan.source.width, plan.source.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas drawing is not available.");
    drawAnnotation(ctx as unknown as DrawingContext, image, plan, number);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    image.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
