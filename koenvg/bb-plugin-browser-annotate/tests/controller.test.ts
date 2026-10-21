import { describe, expect, it, vi } from "vitest";
import type { Annotation, CreateInput } from "../lib/annotation";
import type { AnnotationsRpc } from "../lib/contract";
import {
  createAnnotateController,
  NO_COMPOSER_MESSAGE,
  OFF_SCREEN_MESSAGE,
  type PillWriter,
} from "../lib/controller";

function fakePage() {
  const scripts: string[] = [];
  let listener: ((data: unknown) => void) | null = null;
  let installed = false;
  const page = {
    evaluate: vi.fn(async (script: string) => {
      scripts.push(script);
      if (script.includes("bb.postMessage")) {
        installed = true;
        return true;
      }
      if (script.includes(".teardown(")) installed = false;
      return installed;
    }),
    onMessage: (next: (data: unknown) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  const calls = () =>
    scripts.flatMap((script) => {
      const match = /await api\.(\w+)\((.*)\);/s.exec(script);
      return match ? [`${match[1]}(${match[2]})`] : [];
    });
  return {
    page,
    calls,
    emit: (data: unknown) => listener?.(data),
    navigateAway: () => {
      installed = false;
    },
  };
}

function stored(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "a",
    threadId: "thr",
    url: "https://example.com/a",
    urlKey: "https://example.com/a",
    number: 1,
    kind: "button",
    comment: "Too much padding",
    rect: { x: 10, y: 320, width: 100, height: 40 },
    isFixed: false,
    viewport: { width: 1440, height: 900 },
    ...overrides,
  };
}

function setup(options: { pills?: PillWriter | null; capture?: () => Promise<never> } = {}) {
  const fake = fakePage();
  const annotations: Annotation[] = [];
  const api = {
    create: vi.fn(async (input: CreateInput) => {
      const created = stored({
        id: `id-${input.number}`,
        number: input.number,
        rect: input.rect,
        url: input.url,
      });
      annotations.push(created);
      return { ...created, label: `${input.number} · ${input.kind}` };
    }),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({ removed: [] })),
    listForUrl: vi.fn(async () => annotations),
    listForThread: vi.fn(async () => annotations),
  };
  const rpc = {
    call: (method: keyof typeof api, input: never) => api[method](input),
  } as unknown as AnnotationsRpc;
  const pills: PillWriter = { insert: vi.fn(), remove: vi.fn() };
  const hidden = new Set<string>();
  const order: string[] = [];
  const onModeChange = vi.fn();
  const controller = createAnnotateController({
    threadId: "thr",
    tabId: "tab",
    page: fake.page,
    rpc,
    capture:
      options.capture ??
      (async () => {
        order.push(`capture after ${fake.calls().at(-1)}`);
        return { base64: "AAA", width: 2880, height: 1800 };
      }),
    render: vi.fn(async () => "JPEG"),
    pills: () => (options.pills === undefined ? pills : options.pills),
    isHidden: (id) => hidden.has(id),
    onModeChange,
  });
  return { ...fake, api, pills, controller, order, onModeChange, hidden, annotations };
}

const saveMessage = {
  type: "save",
  url: "https://example.com/a",
  kind: "button",
  comment: "Too much padding",
  rect: { x: 10, y: 20, width: 100, height: 40 },
  scroll: { x: 0, y: 300 },
  isFixed: false,
  viewport: { width: 1440, height: 900 },
};

async function flush(controller: { refreshPins(): Promise<void> }) {
  await controller.refreshPins();
}

describe("annotate controller", () => {
  it("installs the picker and loads the pins of the attached URL", async () => {
    const { controller, api, calls } = setup();

    await controller.attach("https://example.com/b");

    expect(api.listForUrl).toHaveBeenCalledWith({ threadId: "thr", url: "https://example.com/b" });
    expect(calls()).toEqual(["setMode(false)", "setPins([])"]);
  });

  it("reinstalls the picker after the page navigated", async () => {
    const { controller, calls, navigateAway, page } = setup();
    await controller.attach("https://example.com/a");
    await controller.setMode(true);
    navigateAway();
    page.evaluate.mockClear();

    await controller.ensureInstalled();

    expect(
      page.evaluate.mock.calls.filter(([script]) => script.includes("bb.postMessage")),
    ).toHaveLength(1);
    expect(calls().slice(-3)).toEqual(["setMode(true)", "setPins([])", "ping()"]);
  });

  it("captures with the overlay hidden, stores the page rect, and adds a pill", async () => {
    const { controller, emit, api, pills, calls, order } = setup();
    await controller.attach("https://example.com/a");

    emit(saveMessage);
    await flush(controller);

    expect(order).toEqual(["capture after hide()"]);
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 1,
        rect: { x: 10, y: 320, width: 100, height: 40 },
        imageBase64: "JPEG",
      }),
    );
    expect(pills.insert).toHaveBeenCalledWith({ id: "id-1", label: "1 · button" });
    expect(calls()).toContain("saved()");
    expect(calls().indexOf("show()")).toBeGreaterThan(calls().indexOf("hide()"));
  });

  it("keeps the form open and shows the overlay again when the capture fails", async () => {
    const { controller, emit, api, pills, calls } = setup({
      capture: async () => {
        throw new Error("Capture failed");
      },
    });
    await controller.attach("https://example.com/a");

    emit(saveMessage);
    await flush(controller);

    expect(calls()).toContain("show()");
    expect(calls()).toContain('saveFailed("Capture failed")');
    expect(api.create).not.toHaveBeenCalled();
    expect(pills.insert).not.toHaveBeenCalled();
  });

  it("refuses to save without a thread composer", async () => {
    const { controller, emit, api, calls } = setup({ pills: null });
    await controller.attach("https://example.com/a");

    emit(saveMessage);
    await flush(controller);

    expect(calls()).toContain(`saveFailed(${JSON.stringify(NO_COMPOSER_MESSAGE)})`);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("stores an edited comment without touching the pill", async () => {
    const { controller, emit, api, pills } = setup();
    await controller.attach("https://example.com/a");

    emit({ type: "update", id: "a", comment: "Use 8px" });
    await flush(controller);

    expect(api.update).toHaveBeenCalledWith({ threadId: "thr", id: "a", comment: "Use 8px" });
    expect(pills.insert).not.toHaveBeenCalled();
    expect(pills.remove).not.toHaveBeenCalled();
  });

  it("deletes from a pin and removes the pill", async () => {
    const { controller, emit, api, pills } = setup();
    await controller.attach("https://example.com/a");

    emit({ type: "delete", id: "a" });
    await flush(controller);

    expect(api.remove).toHaveBeenCalledWith({ threadId: "thr", id: "a" });
    expect(pills.remove).toHaveBeenCalledWith("a");
  });

  it("leaves out hidden pins without asking the server again", async () => {
    const { controller, api, calls, hidden, annotations } = setup();
    annotations.push(stored({ id: "a" }), stored({ id: "b", number: 2 }));
    await controller.attach("https://example.com/a");
    vi.mocked(api.listForUrl).mockClear();

    hidden.add("a");
    await controller.applyHidden();

    expect(api.listForUrl).not.toHaveBeenCalled();
    expect(calls().at(-1)).toMatch(/^setPins\(\[\{"id":"b"/);
  });

  it("passes the BB theme to the page and keeps it after a reinstall", async () => {
    const { controller, calls, navigateAway, page } = setup();
    const theme = {
      surface: "#111",
      text: "#eee",
      mutedText: "#999",
      border: "#333",
      input: "#000",
      accent: "#eee",
      accentText: "#111",
      ring: "#888",
      danger: "#f55",
      font: "Inter",
    };
    await controller.attach("https://example.com/a");

    await controller.setTheme(theme);
    navigateAway();
    page.evaluate.mockClear();
    await controller.ensureInstalled();

    expect(calls()).toContain(`setTheme(${JSON.stringify(theme)})`);
    expect(page.evaluate.mock.calls.some(([script]) => script.includes("api.setTheme("))).toBe(
      true,
    );
  });

  it("reports Esc from the page as mode off", async () => {
    const { controller, emit, onModeChange } = setup();
    await controller.attach("https://example.com/a");

    emit({ type: "mode", on: false });
    await flush(controller);

    expect(onModeChange).toHaveBeenCalledWith(false);
  });

  it("reports a save whose area scrolled off screen instead of hanging", async () => {
    const { controller, emit, api, calls } = setup();
    await controller.attach("https://example.com/a");

    emit({ ...saveMessage, rect: { x: 10, y: -500, width: 100, height: 40 } });
    await flush(controller);

    expect(api.create).not.toHaveBeenCalled();
    expect(calls()).toContain(`saveFailed(${JSON.stringify(OFF_SCREEN_MESSAGE)})`);
  });

  it("checks for the picker without changing its mode", async () => {
    const { controller, calls } = setup();
    await controller.attach("https://example.com/a");
    await controller.setMode(true);

    await controller.ensureInstalled();

    expect(calls().at(-1)).toBe("ping()");
  });

  it("ignores messages that fail validation", async () => {
    const { controller, emit, api } = setup();
    await controller.attach("https://example.com/a");

    emit({ type: "delete" });
    emit({ type: "save", rect: "everything" });
    await flush(controller);

    expect(api.remove).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
  });
});
