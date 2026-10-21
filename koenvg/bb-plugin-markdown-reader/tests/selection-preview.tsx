import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";
import type { ReaderTarget } from "../source";
import "../app.css";
import "./preview.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const target: ReaderTarget = {
  path: "note.md",
  source: {
    kind: (params.get("source") ?? "workspace") as ReaderTarget["source"]["kind"],
    threadId: "owner",
    environmentId: null,
    projectId: null,
  },
};
const denseText =
  "\uFEFF# Dense\r\n" + "\n".repeat(30_000) + "  alpha **one**\r\n\r\n  beta `two`\r\n";
const rowText = ["# Rows", ...Array.from({ length: 300 }, (_, i) => `line ${i + 1}`), ""].join(
  params.get("ending") === "crlf" ? "\r\n" : "\n",
);
const documents: Record<string, string> = {
  dense: denseText,
  rows: rowText,
  raw: "# Heading\n\n  alpha **one**\n\n  beta `two`\n",
};
const text =
  documents[params.get("document") ?? ""] ??
  "# Heading\n\nSelected prose.\n\n| Left | Right |\n| --- | --- |\n| Table cell | value |\n\n```ts\nconst answer = 42;\n```\n";
const app = await loadPluginApp(pluginApp);
let reads = 0;
const panel = document.getElementById("root")!;
panel.className = "fixture-panel";
panel.style.cssText = `width:${Number(params.get("width")) || 760}px;height:90vh`;
const slot = renderSlot(
  app.fileOpeners[0]!,
  { ...target, Original: () => <p>Original fixture</p> },
  {
    composer: {
      scope: { kind: "thread", threadId: "destination" },
      text: "Keep @owner",
      mentions: [{ kind: "thread", threadId: "owner", label: "@owner", from: 5, to: 11 }],
      attachmentCount: 1,
      attachments: [
        { type: "localFile", name: "keep.txt", path: "/uploads/keep.txt", sizeBytes: 4 },
      ],
    },
    rpc: {
      read_document: async (input) => {
        reads++;
        if (reads > 1 && params.has("hold-refresh"))
          await new Promise<void>((resolve) =>
            window.addEventListener("fixture-release-read", () => resolve(), { once: true }),
          );
        if (reads > 1 && params.has("fail-refresh")) throw new Error("Fixture read failed");
        return {
          kind: "ready",
          snapshot: {
            text,
            target: input as ReaderTarget,
            sha256: "hash",
            sizeBytes: text.length,
            hostId: "remote",
            rootPath: "/work",
            documentPath: "/work/note.md",
            documentDirectory: "/work",
          },
        };
      },
    },
  },
);
slot.container.style.height = "100%";
panel.append(slot.container);
Object.assign(window, {
  selectionFixture: slot,
  revealSelectionLines: (startLineNumber: number | null, endLineNumber: number | null) => {
    const Opener = app.fileOpeners[0]!.component;
    slot.lifecycle.rerender(
      <Opener
        {...target}
        experimental_lineRange={
          startLineNumber === null || endLineNumber === null
            ? null
            : { startLineNumber, endLineNumber }
        }
        Original={() => <p>Original fixture</p>}
      />,
    );
  },
  changeSelectionFile: () => {
    const Opener = app.fileOpeners[0]!.component;
    slot.lifecycle.rerender(
      <Opener {...target} path="changed.md" Original={() => <p>Changed Original</p>} />,
    );
  },
});
if (params.has("two")) {
  const second = renderSlot(
    app.fileOpeners[0]!,
    { ...target, Original: () => <p>Second Original</p> },
    {
      composer: { scope: { kind: "thread", threadId: "second" } },
      rpc: {
        read_document: async () => ({
          kind: "ready",
          snapshot: {
            text: "# Second\n\nSecond reader prose.\n",
            target,
            sha256: "second",
            sizeBytes: 30,
            hostId: "remote",
            rootPath: "/work",
            documentPath: "/work/note.md",
            documentDirectory: "/work",
          },
        }),
      },
    },
  );
  second.container.style.height = "100%";
  panel.style.height = "45vh";
  const nextPanel = document.createElement("div");
  nextPanel.className = "fixture-panel";
  nextPanel.style.cssText = panel.style.cssText;
  nextPanel.append(second.container);
  panel.after(nextPanel);
  Object.assign(window, { secondSelectionFixture: second });
}
