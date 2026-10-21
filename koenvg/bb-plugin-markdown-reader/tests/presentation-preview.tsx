// Registered reader + public frontend harness. No live BB source or navigation calls.
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";
import type { ReaderTarget } from "../source";
import type { DestinationRequest, DestinationResult } from "../destination-types";
import report from "./fixtures/presentation.md?raw";
import lists from "./fixtures/lists.md?raw";
import "../app.css";
import "./preview.css";
import parityReport from "../../packages/markdown-document/test/fixtures/parity-report.md?raw";
import "../../packages/markdown-document/test/fixtures/parity.css";

const params = new URLSearchParams(location.search);
if (params.has("parity")) document.documentElement.dataset.documentParity = "true";
const target: ReaderTarget = {
  path: params.get("path") ?? "reports/" + "long-document-title-".repeat(12) + ".md",
  source: {
    kind: "workspace",
    threadId: null,
    environmentId: "fixture",
    projectId: "fixture",
    experimental_hostId: "fixture-host",
  },
};
const text = params.has("parity")
  ? parityReport
  : params.get("headings") === "none"
    ? 'Plain text without headings.\n\n```json\n{"plain":true}\n```\n'
    : params.get("document") === "lists"
      ? lists
      : report;
const identity = {
  hostId: "fixture-host",
  rootPath: "/fixture",
  documentPath: "/fixture/" + target.path,
};
document.documentElement.dataset.theme = params.get("theme") ?? "light";
const root = document.getElementById("root")!;
root.className = "fixture-layout";
const sentinel = document.createElement("aside");
sentinel.className = "fixture-outside fixture-sentinel";
sentinel.setAttribute("aria-label", "Host style sentinel");
for (const [tag, label] of [
  ["h2", "Adjacent chrome"],
  ["p", "Host text"],
  ["code", "Host code"],
  ["button", "Host button"],
]) {
  const element = document.createElement(tag!);
  element.textContent = label!;
  sentinel.append(element);
}
sentinel.style.cssText = `display:${params.has("sentinel") ? "block" : "none"};position:fixed;left:${(Number(params.get("width")) || 760) + 24}px;top:16px`;
root.append(sentinel);
const panel = document.createElement("div");
panel.className = "fixture-panel";
panel.style.cssText = `width:${Number(params.get("width")) || 760}px;max-width:100%`;
root.append(panel);
const app = await loadPluginApp(pluginApp);
const slot = renderSlot(
  app.fileOpeners[0]!,
  { ...target, Original: () => <p>Bound Original fixture</p> },
  {
    rpc: {
      read_document: async () => ({
        kind: "ready",
        snapshot: {
          text,
          target,
          sha256: "unchanged",
          sizeBytes: new TextEncoder().encode(text).length,
          ...identity,
          documentDirectory: "/fixture/reports",
        },
      }),
      resolve_destinations: async (input): Promise<DestinationResult> => {
        const { requests } = input as { requests: DestinationRequest[] };
        return {
          identity,
          destinations: requests.map((request) =>
            params.has("parity") && !request.image && request.url === "notes.md"
              ? {
                  kind: "local-file",
                  hostId: identity.hostId,
                  target: { kind: "workspace", environmentId: "fixture", path: "reports/notes.md" },
                }
              : request.image && request.url === "https://fixture.invalid/diagram.png"
                ? { kind: "image", remote: true, url: request.url }
                : { kind: "rejected", reason: "Unsupported fixture destination" },
          ),
        };
      },
    },
  },
);
// The real file-panel slot has a definite height. Give the harness wrapper that height too.
slot.container.style.height = "100%";
panel.append(slot.container);
Object.assign(window, {
  presentationFixture: { inspection: slot.inspection, text, panel, target },
});
