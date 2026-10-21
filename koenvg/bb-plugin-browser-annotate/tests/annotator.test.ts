import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAnnotator, type AnnotatorApi, type PagePin } from "../lib/page/annotator";
import { annotatorCallScript, annotatorInstallScript } from "../lib/page/script";

type TestWindow = Window & { __bbBrowserAnnotate?: AnnotatorApi };
const win = window as TestWindow;

function rectOf(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
}

let posted: unknown[];
let api: AnnotatorApi;
let link: HTMLAnchorElement;
let hitTarget: Element | null;

function host() {
  return document.querySelector("bb-browser-annotate") as HTMLElement;
}
function shadow() {
  return host().shadowRoot!;
}
function layer() {
  return shadow().querySelector(".layer") as HTMLElement;
}
function textarea() {
  return shadow().querySelector(".form textarea") as HTMLTextAreaElement;
}
function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init }),
  );
}
function click(x: number, y: number) {
  layer().dispatchEvent(pointer("pointermove", x, y));
  layer().dispatchEvent(pointer("pointerdown", x, y));
  layer().dispatchEvent(pointer("pointerup", x, y));
  layer().dispatchEvent(pointer("click", x, y));
}
function drag(from: [number, number], to: [number, number]) {
  layer().dispatchEvent(pointer("pointerdown", ...from));
  layer().dispatchEvent(pointer("pointermove", ...to));
  layer().dispatchEvent(pointer("pointerup", ...to));
}

beforeEach(() => {
  document.body.innerHTML = '<a href="#next" id="link">Next</a>';
  link = document.getElementById("link") as HTMLAnchorElement;
  link.getBoundingClientRect = () => rectOf(100, 200, 80, 30);
  hitTarget = link;
  document.elementFromPoint = vi.fn(() => hitTarget);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
  posted = [];
  api = installAnnotator(win, (message) => posted.push(message), "open");
  api.setMode(true);
});

afterEach(() => {
  win.__bbBrowserAnnotate?.teardown();
  vi.restoreAllMocks();
});

describe("annotate mode", () => {
  it("keeps clicks away from the page", () => {
    const pageClick = vi.fn();
    link.addEventListener("click", pageClick);
    document.addEventListener("click", pageClick);

    click(120, 210);

    expect(pageClick).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
  });

  it("leaves one host when installed twice", () => {
    installAnnotator(win, () => {}, "open");

    expect(document.querySelectorAll("bb-browser-annotate")).toHaveLength(1);
  });

  it("turns off with Esc and tells the plugin", () => {
    press(document.body, "Escape");

    expect(layer()).toBeNull();
    expect(posted).toEqual([{ type: "mode", on: false }]);
  });

  it("applies the BB theme and keeps defaults for missing tokens", () => {
    api.setTheme({
      surface: "#0b0b0c",
      text: "#f4f4f5",
      mutedText: "",
      border: "#27272a",
      input: "#0b0b0c",
      accent: "#e4e4e7",
      accentText: "#0b0b0c",
      ring: "#71717a",
      danger: "",
      font: "Inter",
    });

    expect(host().style.getPropertyValue("--bba-surface")).toBe("#0b0b0c");
    expect(host().style.getPropertyValue("--bba-mutedText")).toBe("");
    expect(shadow().querySelector("style")!.textContent).not.toMatch(/#ff00ff|255,\s*0,\s*255/i);
  });

  it("removes everything on teardown", () => {
    api.teardown();

    expect(host()).toBeNull();
    expect(win.__bbBrowserAnnotate).toBeUndefined();
  });
});

describe("hover and selection", () => {
  it("outlines the hovered element in white with a dark shadow and a size label", () => {
    layer().dispatchEvent(pointer("pointermove", 120, 210));

    const highlight = shadow().querySelector(".highlight") as HTMLElement;
    expect(highlight.style.left).toBe("100px");
    expect(highlight.style.width).toBe("80px");
    const css = shadow().querySelector("style")!.textContent!;
    expect(css).toMatch(
      /\.highlight \{[^}]*border: 2px solid #fff;[^}]*box-shadow: 0 0 0 1px rgba\(0,0,0,\.85\)/,
    );
    expect(shadow().querySelector(".tag")!.textContent).toBe("a 80×30");
  });

  it("selects the element box on click and saves it with the comment", () => {
    click(120, 210);
    textarea().value = "Too much padding";
    press(textarea(), "Enter");

    expect(posted).toEqual([
      {
        type: "save",
        url: location.href,
        kind: "a",
        comment: "Too much padding",
        rect: { x: 100, y: 200, width: 80, height: 30 },
        scroll: { x: 0, y: 0 },
        isFixed: false,
        viewport: { width: 1440, height: 900 },
      },
    ]);
  });

  it("selects a region on a drag of 6 px or more", () => {
    drag([300, 300], [500, 400]);
    textarea().value = "Wrong color";
    press(textarea(), "Enter");

    expect(posted[0]).toMatchObject({
      kind: "region",
      rect: { x: 300, y: 300, width: 200, height: 100 },
    });
  });

  it("treats a drag under 6 px as a click", () => {
    layer().dispatchEvent(pointer("pointermove", 120, 210));
    drag([120, 210], [124, 213]);
    textarea().value = "x";
    press(textarea(), "Enter");

    expect(posted[0]).toMatchObject({ kind: "a", rect: { x: 100, y: 200, width: 80, height: 30 } });
  });

  it("clips a region to the viewport", () => {
    drag([1400, 850], [1600, 1000]);
    textarea().value = "x";
    press(textarea(), "Enter");

    expect(posted[0]).toMatchObject({ rect: { x: 1400, y: 850, width: 40, height: 50 } });
  });
});

describe("comment entry", () => {
  beforeEach(() => click(120, 210));

  it("does not save a blank comment", () => {
    textarea().value = "   ";
    press(textarea(), "Enter");

    expect(posted).toEqual([]);
    expect(textarea()).not.toBeNull();
  });

  it("adds a new line with Shift+Enter", () => {
    textarea().value = "line";
    press(textarea(), "Enter", { shiftKey: true });

    expect(posted).toEqual([]);
  });

  it("cancels with Esc and stays in annotate mode", () => {
    press(textarea(), "Escape");

    expect(textarea()).toBeNull();
    expect(layer()).not.toBeNull();
    expect(posted).toEqual([]);
  });

  it("limits comments to 4000 characters", () => {
    expect(textarea().maxLength).toBe(4000);
  });

  it("keeps the form open with an error when saving fails, and closes it when saved", () => {
    textarea().value = "x";
    press(textarea(), "Enter");
    expect(textarea().disabled).toBe(true);

    api.saveFailed("Screenshot failed");
    expect(textarea().disabled).toBe(false);
    expect(shadow().querySelector(".error")!.textContent).toBe("Screenshot failed");

    press(textarea(), "Enter");
    api.saved();
    expect(textarea()).toBeNull();
    expect(layer()).not.toBeNull();
  });

  it("keeps typing in the form away from page key handlers", () => {
    const pageKeys = vi.fn();
    document.addEventListener("keydown", pageKeys, true);
    window.addEventListener("keydown", pageKeys);
    textarea().value = "Too much padding";

    press(textarea(), "s");
    press(textarea(), "Enter");

    expect(pageKeys).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    document.removeEventListener("keydown", pageKeys, true);
    window.removeEventListener("keydown", pageKeys);
  });

  it("does not close a pin edit form when an earlier save finishes", () => {
    textarea().value = "x";
    press(textarea(), "Enter");
    api.setPins([
      {
        id: "a",
        number: 1,
        comment: "Old",
        rect: { x: 0, y: 0, width: 10, height: 10 },
        isFixed: true,
      },
    ]);
    shadow().querySelector<HTMLElement>(".pin")!.click();

    api.saved();

    expect(textarea().value).toBe("Old");
  });

  it("hides the overlay for a capture and shows it again", async () => {
    await api.hide();
    expect(host().style.visibility).toBe("hidden");

    api.show();
    expect(host().style.visibility).toBe("visible");
  });
});

describe("pins", () => {
  const pins: PagePin[] = [
    {
      id: "a",
      number: 1,
      comment: "Too much padding",
      rect: { x: 100, y: 600, width: 80, height: 30 },
      isFixed: false,
    },
    {
      id: "b",
      number: 2,
      comment: "Header",
      rect: { x: 0, y: 0, width: 1440, height: 60 },
      isFixed: true,
    },
  ];
  const badges = () => [...shadow().querySelectorAll<HTMLElement>(".pin")];

  beforeEach(() => api.setPins(pins));

  it("draws numbered pins that move on scroll, except fixed ones", () => {
    expect(badges().map((badge) => [badge.textContent, badge.style.top])).toEqual([
      ["1", "589px"],
      ["2", "-11px"],
    ]);

    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
    window.dispatchEvent(new Event("scroll"));

    expect(badges().map((badge) => badge.style.top)).toEqual(["289px", "-11px"]);
  });

  it("edits a comment from its pin", () => {
    badges()[0]!.click();
    expect(textarea().value).toBe("Too much padding");
    textarea().value = "Use 8px";
    press(textarea(), "Enter");

    expect(posted).toEqual([{ type: "update", id: "a", comment: "Use 8px" }]);
    expect(textarea()).toBeNull();
  });

  it("deletes from its pin", () => {
    badges()[1]!.click();
    (shadow().querySelector("button.danger") as HTMLButtonElement).click();

    expect(posted).toEqual([{ type: "delete", id: "b" }]);
  });

  it("keeps pins clickable when annotate mode is off", () => {
    api.setMode(false);
    badges()[0]!.click();

    expect(textarea()).not.toBeNull();
  });
});

describe("serialized script", () => {
  it("installs from the evaluated string with only window and bb in scope", async () => {
    api.teardown();
    const postMessage = vi.fn();
    const run = (script: string) =>
      new Function("window", "bb", `return ${script}`)(window, { postMessage });

    expect(run(annotatorInstallScript())).toBe(true);
    expect(await run(annotatorCallScript("setMode", true))).toBe(true);
    press(document.body, "Escape");

    expect(postMessage).toHaveBeenCalledWith({ type: "mode", on: false });
  });

  it("reports when the annotator is not installed", async () => {
    api.teardown();

    expect(await new Function(`return ${annotatorCallScript("show")}`)()).toBe(false);
  });
});
