import type { Annotation } from "./annotation";
import type { AnnotationsRpc } from "./contract";
import { planCrop, type CropPlan } from "./geometry";
import type { AnnotatorApi, PagePin, PageTheme } from "./page/annotator";
import { parsePageMessage, type SaveMessage } from "./page/messages";
import { annotatorCallScript, annotatorInstallScript } from "./page/script";
import type { PageScripting, TabCapture } from "./sdk-adapter";

export interface PillWriter {
  insert(pill: { id: string; label: string }): void;
  remove(id: string): void;
}

export interface ControllerDeps {
  threadId: string;
  tabId: string;
  page: PageScripting;
  rpc: AnnotationsRpc;
  capture(tab: { threadId: string; tabId: string }): Promise<TabCapture>;
  render(capture: TabCapture, plan: CropPlan, number: number): Promise<string>;
  pills(): PillWriter | null;
  isHidden(id: string): boolean;
  onModeChange(on: boolean): void;
}

export const NO_COMPOSER_MESSAGE = "Open this thread's chat to add annotations.";
export const OFF_SCREEN_MESSAGE =
  "The marked area is not on screen. Scroll back to it and save again.";

function toPin({ id, number, comment, rect, isFixed }: Annotation): PagePin {
  return { id, number, comment, rect, isFixed };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The annotation could not be saved.";
}

export function createAnnotateController(deps: ControllerDeps) {
  const { threadId, tabId, page, rpc } = deps;
  let url = "";
  let modeOn = false;
  let theme: PageTheme | null = null;
  let loadedPins: PagePin[] = [];
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();

  async function install() {
    await page.evaluate(annotatorInstallScript());
    if (theme) await page.evaluate(annotatorCallScript("setTheme", theme));
    await page.evaluate(annotatorCallScript("setMode", modeOn));
    await page.evaluate(annotatorCallScript("setPins", await pins()));
  }

  async function call<M extends keyof AnnotatorApi>(
    method: M,
    ...args: Parameters<AnnotatorApi[M]>
  ) {
    if ((await page.evaluate(annotatorCallScript(method, ...args))) !== false) return;
    await install();
    await page.evaluate(annotatorCallScript(method, ...args));
  }

  async function pins(): Promise<PagePin[]> {
    loadedPins = url ? (await rpc.call("listForUrl", { threadId, url })).map(toPin) : [];
    return visible();
  }

  function visible(): PagePin[] {
    return loadedPins.filter((pin) => !deps.isHidden(pin.id));
  }

  async function refreshPins() {
    await call("setPins", await pins());
  }

  async function nextNumber(): Promise<number> {
    const existing = await rpc.call("listForThread", { threadId });
    return existing.reduce((max, annotation) => Math.max(max, annotation.number), 0) + 1;
  }

  async function save(message: SaveMessage) {
    const pills = deps.pills();
    if (!pills) {
      await call("saveFailed", NO_COMPOSER_MESSAGE);
      return;
    }
    try {
      const number = await nextNumber();
      let capture: TabCapture;
      await call("hide");
      try {
        capture = await deps.capture({ threadId, tabId });
      } finally {
        await call("show");
      }
      const plan = planCrop(message.rect, message.viewport, capture);
      const imageBase64 = await deps.render(capture, plan, number);
      const rect = message.isFixed
        ? message.rect
        : {
            ...message.rect,
            x: message.rect.x + message.scroll.x,
            y: message.rect.y + message.scroll.y,
          };
      const created = await rpc.call("create", {
        threadId,
        url: message.url,
        number,
        kind: message.kind,
        comment: message.comment,
        rect,
        isFixed: message.isFixed,
        viewport: message.viewport,
        imageBase64,
      });
      pills.insert({ id: created.id, label: created.label });
      await call("saved");
      await refreshPins();
    } catch (error) {
      await call("saveFailed", errorMessage(error));
    }
  }

  async function handle(data: unknown) {
    const message = parsePageMessage(data);
    if (!message) {
      if ((data as { type?: unknown } | null)?.type === "save")
        await call("saveFailed", OFF_SCREEN_MESSAGE);
      return;
    }
    switch (message.type) {
      case "save":
        return save(message);
      case "update":
        try {
          await rpc.call("update", { threadId, id: message.id, comment: message.comment });
        } finally {
          await refreshPins();
        }
        return;
      case "delete":
        await rpc.call("remove", { threadId, id: message.id });
        deps.pills()?.remove(message.id);
        return refreshPins();
      case "mode":
        modeOn = message.on;
        deps.onModeChange(message.on);
        return;
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    queue = queue.then(() => (disposed ? undefined : task())).catch(() => undefined);
    return queue;
  }

  const unsubscribe = page.onMessage((data) => void enqueue(() => handle(data)));

  return {
    attach(nextUrl: string) {
      url = nextUrl;
      return enqueue(install);
    },
    setMode(on: boolean) {
      modeOn = on;
      return enqueue(() => call("setMode", on));
    },
    setTheme(next: PageTheme) {
      theme = next;
      return enqueue(() => call("setTheme", next));
    },
    refreshPins() {
      return enqueue(refreshPins);
    },
    applyHidden() {
      return enqueue(() => call("setPins", visible()));
    },
    ensureInstalled() {
      return enqueue(() => call("ping"));
    },
    dispose() {
      disposed = true;
      unsubscribe();
      void page.evaluate(annotatorCallScript("teardown")).catch(() => undefined);
    },
  };
}

export type AnnotateController = ReturnType<typeof createAnnotateController>;
