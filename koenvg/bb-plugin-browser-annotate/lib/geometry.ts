import type { Rect, Viewport } from "./annotation";

export const CROP_PADDING_RATIO = 0.1;
export const MIN_CROP_PADDING = 120;
export const FULL_VIEW_AREA_RATIO = 0.6;

export interface Size {
  width: number;
  height: number;
}

export interface CropPlan {
  scale: number;
  source: Rect;
  box: Rect;
}

export function clipRect(rect: Rect, bounds: Size): Rect {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.height, rect.y + rect.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function planCrop(box: Rect, viewport: Viewport, image: Size): CropPlan {
  const target = clipRect(box, viewport);
  const padX = Math.max(viewport.width * CROP_PADDING_RATIO, MIN_CROP_PADDING);
  const padY = Math.max(viewport.height * CROP_PADDING_RATIO, MIN_CROP_PADDING);
  let crop = clipRect(
    {
      x: target.x - padX,
      y: target.y - padY,
      width: target.width + 2 * padX,
      height: target.height + 2 * padY,
    },
    viewport,
  );
  if (crop.width * crop.height > FULL_VIEW_AREA_RATIO * viewport.width * viewport.height) {
    crop = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  }
  const scale = image.width / viewport.width;
  const source = clipRect(
    {
      x: Math.round(crop.x * scale),
      y: Math.round(crop.y * scale),
      width: Math.round(crop.width * scale),
      height: Math.round(crop.height * scale),
    },
    image,
  );
  return {
    scale,
    source,
    box: {
      x: (target.x - crop.x) * scale,
      y: (target.y - crop.y) * scale,
      width: target.width * scale,
      height: target.height * scale,
    },
  };
}

export function placeLabel(
  box: Rect,
  label: Size,
  canvas: Size,
  gap: number,
): { x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(0, x), Math.max(0, canvas.width - label.width));
  const clampY = (y: number) => Math.min(Math.max(0, y), Math.max(0, canvas.height - label.height));
  const above = box.y - gap - label.height;
  if (above >= 0) return { x: clampX(box.x), y: above };
  const below = box.y + box.height + gap;
  if (below + label.height <= canvas.height) return { x: clampX(box.x), y: below };
  const right = box.x + box.width + gap;
  if (right + label.width <= canvas.width) return { x: right, y: clampY(box.y) };
  const left = box.x - gap - label.width;
  if (left >= 0) return { x: left, y: clampY(box.y) };
  return { x: clampX(box.x + gap), y: clampY(box.y + gap) };
}
