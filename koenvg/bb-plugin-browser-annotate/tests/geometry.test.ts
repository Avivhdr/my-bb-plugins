import { describe, expect, it } from "vitest";
import { planCrop, placeLabel } from "../lib/geometry";

const viewport = { width: 1440, height: 900 };
const image1x = { width: 1440, height: 900 };

describe("planCrop", () => {
  it("pads a small centered element by 10% of the width and at least 120 px", () => {
    const plan = planCrop({ x: 670, y: 430, width: 100, height: 40 }, viewport, image1x);

    expect(plan.source).toEqual({ x: 526, y: 310, width: 388, height: 280 });
    expect(plan.box).toEqual({ x: 144, y: 120, width: 100, height: 40 });
  });

  it("stops the crop at the viewport edge", () => {
    const plan = planCrop({ x: 670, y: 0, width: 100, height: 40 }, viewport, image1x);

    expect(plan.source.y).toBe(0);
    expect(plan.box.y).toBe(0);
    expect(plan.source.height).toBe(160);
  });

  it("uses the full viewport when the crop covers more than 60% of it", () => {
    const plan = planCrop({ x: 200, y: 150, width: 900, height: 500 }, viewport, image1x);

    expect(plan.source).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
    expect(plan.box).toEqual({ x: 200, y: 150, width: 900, height: 500 });
  });

  it("scales from the capture width for a 2x capture", () => {
    const plan = planCrop({ x: 670, y: 430, width: 100, height: 40 }, viewport, {
      width: 2880,
      height: 1800,
    });

    expect(plan.scale).toBe(2);
    expect(plan.source).toEqual({ x: 1052, y: 620, width: 776, height: 560 });
    expect(plan.box).toEqual({ x: 288, y: 240, width: 200, height: 80 });
  });

  it("clips a box that extends past the viewport", () => {
    const plan = planCrop({ x: 1400, y: 880, width: 100, height: 100 }, viewport, image1x);

    expect(plan.box.width).toBe(40);
    expect(plan.box.height).toBe(20);
    expect(plan.source.x + plan.source.width).toBe(1440);
  });
});

describe("placeLabel", () => {
  const label = { width: 20, height: 22 };
  const canvas = { width: 400, height: 300 };

  it("puts the label above the box when there is room", () => {
    expect(placeLabel({ x: 100, y: 100, width: 50, height: 50 }, label, canvas, 4)).toEqual({
      x: 100,
      y: 74,
    });
  });

  it("puts the label below a box at the top edge", () => {
    expect(placeLabel({ x: 100, y: 0, width: 50, height: 50 }, label, canvas, 4)).toEqual({
      x: 100,
      y: 54,
    });
  });

  it("puts the label beside a box that spans the full height", () => {
    expect(placeLabel({ x: 100, y: 0, width: 50, height: 300 }, label, canvas, 4)).toEqual({
      x: 154,
      y: 0,
    });
  });

  it("falls back to the inside corner when the box fills the canvas", () => {
    expect(placeLabel({ x: 0, y: 0, width: 400, height: 300 }, label, canvas, 4)).toEqual({
      x: 4,
      y: 4,
    });
  });

  it("keeps the label inside the canvas at the right edge", () => {
    expect(placeLabel({ x: 390, y: 100, width: 10, height: 10 }, label, canvas, 4).x).toBe(380);
  });
});
