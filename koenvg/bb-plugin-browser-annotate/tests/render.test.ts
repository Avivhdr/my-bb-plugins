import { describe, expect, it } from "vitest";
import { planCrop } from "../lib/geometry";
import { drawAnnotation, OUTLINE_DARK, OUTLINE_LIGHT, type DrawingContext } from "../lib/render";

function fakeContext() {
  const calls: { op: string; args: unknown[]; style?: unknown; lineWidth?: number }[] = [];
  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    font: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    drawImage: (...args: unknown[]) => calls.push({ op: "drawImage", args }),
    strokeRect: (...args: unknown[]) =>
      calls.push({ op: "strokeRect", args, style: ctx.strokeStyle, lineWidth: ctx.lineWidth }),
    fillRect: (...args: unknown[]) => calls.push({ op: "fillRect", args, style: ctx.fillStyle }),
    fillText: (...args: unknown[]) => calls.push({ op: "fillText", args, style: ctx.fillStyle }),
    measureText: (text: string) => ({ width: 8 * text.length }) as TextMetrics,
  };
  return { ctx: ctx as unknown as DrawingContext, calls };
}

const image = {} as CanvasImageSource;
const viewport = { width: 1440, height: 900 };
const box = { x: 670, y: 430, width: 100, height: 40 };

describe("drawAnnotation", () => {
  it.each([
    [1, { width: 1440, height: 900 }],
    [2, { width: 2880, height: 1800 }],
  ])("draws the crop and a dark and a light outline just outside the box at %ix", (scale, size) => {
    const { ctx, calls } = fakeContext();
    const plan = planCrop(box, viewport, size);

    drawAnnotation(ctx, image, plan, 3);

    const { source } = plan;
    expect(calls[0]).toEqual({
      op: "drawImage",
      args: [
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        source.width,
        source.height,
      ],
    });
    const lineWidth = 2 * scale;
    const strokes = calls.filter((call) => call.op === "strokeRect");
    expect(strokes.map((stroke) => [stroke.style, stroke.lineWidth])).toEqual([
      [OUTLINE_DARK, lineWidth],
      [OUTLINE_LIGHT, lineWidth],
    ]);
    expect(strokes[0]!.args).toEqual([
      plan.box.x - lineWidth / 2,
      plan.box.y - lineWidth / 2,
      plan.box.width + lineWidth,
      plan.box.height + lineWidth,
    ]);
    expect(strokes[1]!.args).toEqual([
      plan.box.x - lineWidth * 1.5,
      plan.box.y - lineWidth * 1.5,
      plan.box.width + lineWidth * 3,
      plan.box.height + lineWidth * 3,
    ]);
  });

  it("fills only the number label, outside the outline", () => {
    const { ctx, calls } = fakeContext();
    const plan = planCrop(box, viewport, { width: 1440, height: 900 });

    drawAnnotation(ctx, image, plan, 12);

    const fills = calls.filter((call) => call.op === "fillRect");
    expect(fills.map((fill) => fill.style)).toEqual([OUTLINE_LIGHT, OUTLINE_DARK]);
    const [, y, , height] = fills[0]!.args as number[];
    expect(y! + height!).toBeLessThanOrEqual(plan.box.y - 4);
    expect(calls.find((call) => call.op === "fillText")!.args[0]).toBe("12");
  });
});
