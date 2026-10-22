import { describe, expect, it } from "vitest";
import { indexPrompts, isPromptRowId, pinFor, promptOf, threadIdOf, type RowBox } from "./model";

// Rows as the server lists them. The page shows the same thread, but merges
// tool work into "work-summary" rows that only carry the turn id.
const index = indexPrompts({
  rowIds: ["t:user-seed:1", "t:work:2", "t:assistant:kind:assistant|turn:aa11-t1|x", "t:user-seed:4", "t:work:5"],
  prompts: [
    { rowId: "t:user-seed:1", index: 0, text: "first ask", turnIds: ["aa11-t1"] },
    { rowId: "t:user-seed:4", index: 3, text: "second ask", turnIds: ["aa11-t2"] },
  ],
});
const box = (id: string, top: number, height = 100): RowBox => ({ id, top, bottom: top + height });
const noText = () => null;

describe("promptOf", () => {
  it("places a row the server listed", () => {
    expect(promptOf(index, "t:work:2")).toBe(0);
    expect(promptOf(index, "t:user-seed:4")).toBe(1);
    expect(promptOf(index, "t:work:5")).toBe(1);
  });
  it("places a page-only row by its turn id", () => {
    expect(promptOf(index, "t:aa11-t2:work-summary:t:completed")).toBe(1);
  });
  it("does not mistake turn t2 for t20", () => {
    expect(promptOf(index, "t:aa11-t20:work-summary")).toBeUndefined();
  });
  it("returns -1 before the first prompt and undefined for an unknown row", () => {
    const late = indexPrompts({
      rowIds: ["t:op:1", "t:user-seed:2"],
      prompts: [{ rowId: "t:user-seed:2", index: 1, text: "x", turnIds: [] }],
    });
    expect(promptOf(late, "t:op:1")).toBe(-1);
    expect(promptOf(index, "t:new:9")).toBeUndefined();
  });
});

describe("pinFor", () => {
  it("pins the prompt of the turn at the top once the prompt has scrolled away", () => {
    const rows = [box("t:work:2", -150), box("t:assistant:kind:assistant|turn:aa11-t1|x", -50)];
    expect(pinFor(index, rows, 0, 1000, noText)).toEqual({
      pin: { rowId: "t:user-seed:1", text: "first ask", index: 0 },
      stale: false,
    });
  });
  it("resolves a screen of work-summary rows through their turn", () => {
    const rows = [box("t:aa11-t2:work-summary:a", -300), box("t:aa11-t2:work-summary:b", -40)];
    expect(pinFor(index, rows, 0, 1000, noText).pin?.text).toBe("second ask");
  });
  it("hides the pin while the prompt is still on screen", () => {
    const rows = [box("t:user-seed:4", -60), box("t:work:5", 40)];
    expect(pinFor(index, rows, 0, 1000, noText).pin).toBeNull();
  });
  it("hides the older prompt while a newer prompt is on screen", () => {
    const rows = [box("t:assistant:kind:assistant|turn:aa11-t1|x", -50), box("t:user-seed:4", 300)];
    expect(pinFor(index, rows, 0, 1000, noText).pin).toBeNull();
  });
  it("pins the older prompt once the newer one drops below the view", () => {
    const rows = [box("t:assistant:kind:assistant|turn:aa11-t1|x", -50), box("t:user-seed:4", 1200)];
    expect(pinFor(index, rows, 0, 1000, noText).pin?.text).toBe("first ask");
  });
  it("counts a prompt row the index doesn't know yet", () => {
    const rows = [box("t:work:5", -50), box("t:user-seed:9", 300)];
    expect(pinFor(index, rows, 0, 1000, noText).pin).toBeNull();
  });
  it("shows the pin once the prompt is fully above the edge", () => {
    const rows = [box("t:user-seed:4", -100), box("t:work:5", 0)];
    expect(pinFor(index, rows, 0, 1000, noText).pin?.text).toBe("second ask");
  });
  it("judges an unknown anchor by the rows below it", () => {
    expect(pinFor(index, [box("t:op:x", -50), box("t:work:5", 50)], 0, 1000, noText).pin?.text).toBe("second ask");
    // The next row is a prompt, so the anchor belongs to the turn before it.
    expect(pinFor(index, [box("t:op:x", -50), box("t:user-seed:4", 50)], 0, 40, noText).pin?.text).toBe("first ask");
  });
  it("reads the prompt from the page and asks for a refetch when nothing resolves", () => {
    const rows = [box("t:user-seed:7", -300), box("t:new:8", -50)];
    const result = pinFor(index, rows, 0, 1000, (id) => (id === "t:user-seed:7" ? "from the page" : null));
    expect(result).toEqual({ pin: { rowId: "t:user-seed:7", text: "from the page", index: null }, stale: true });
  });
  it("asks for the index before it has loaded", () => {
    expect(pinFor(null, [box("t:work:2", 0)], 0, 1000, noText)).toEqual({ pin: null, stale: true });
  });
  it("pins nothing when no row reaches the visible area", () => {
    expect(pinFor(index, [box("t:work:2", -300)], 0, 1000, noText)).toEqual({ pin: null, stale: false });
  });
});

describe("row ids", () => {
  it("reads the thread id and spots prompt rows", () => {
    expect(threadIdOf("thr_bt2sx34nfz:user-seed:956")).toBe("thr_bt2sx34nfz");
    expect(threadIdOf("nope")).toBeNull();
    expect(isPromptRowId("thr_a:user-seed:1")).toBe(true);
    expect(isPromptRowId("thr_a:user:1")).toBe(true);
    expect(isPromptRowId("thr_a:assistant:kind:assistant")).toBe(false);
  });
});
