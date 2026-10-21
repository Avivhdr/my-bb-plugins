// Browser fixture. RPC responses and native opening are fake; image GETs are intercepted.
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";
import type { ReaderTarget } from "../source";
import type { DestinationResult, DestinationRequest } from "../destination-types";
import "../app.css";
import "./preview.css";

const params = new URLSearchParams(location.search);
const source = params.get("source") ?? "workspace";
const target: ReaderTarget =
  source === "host"
    ? {
        path: "/notes/note.md",
        source: {
          kind: "host",
          threadId: null,
          environmentId: null,
          projectId: null,
          experimental_hostId: "remote",
        },
      }
    : {
        path: "reports/note.md",
        source: {
          kind: source === "thread-storage" ? "thread-storage" : "workspace",
          threadId: "thread",
          environmentId: "env",
          projectId: null,
        },
      };
const rootPath = source === "host" ? "/notes" : source === "thread-storage" ? "/storage" : "/work";
const identity = {
  hostId: "remote",
  rootPath,
  documentPath: `${rootPath}/${source === "host" ? "" : "reports/"}note.md`,
};
const text =
  "# Destinations\n\n[sibling](next.md) [web](https://example.com/guide) [here](#destinations)\n\nUnsafe: [script](javascript:alert(1)) [escape](../../outside.md)\n\n[![Local picture](picture.png)](next.md)\n\n![Confined symlink alt](escape.png)\n\n![Remote picture](https://images.test/picture.png)\n\n![Rejected SVG alt](active.svg)\n\nFootnote[^1].\n\n[^1]: Local note.\n";
let reads = 0,
  resolutions = 0;
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.getElementById("root")!.style.cssText =
  `width:${Number(params.get("width")) || 760}px;max-width:100%;height:850px`;
const app = await loadPluginApp(pluginApp);
const slot = renderSlot(
  app.fileOpeners[0]!,
  { ...target, Original: () => <p>Bound Original fixture</p> },
  {
    rpc: {
      read_document: async () => {
        document.documentElement.dataset.fixtureReads = String(++reads);
        return {
          kind: "ready",
          snapshot: {
            text,
            sha256: "unchanged",
            sizeBytes: text.length,
            target,
            ...identity,
            documentDirectory: identity.documentPath.slice(
              0,
              identity.documentPath.lastIndexOf("/"),
            ),
          },
        };
      },
      resolve_destinations: async (input): Promise<DestinationResult> => {
        const { requests } = input as { requests: DestinationRequest[] };
        const generation = ++resolutions;
        document.documentElement.dataset.fixtureResolutions = String(generation);
        return {
          identity,
          destinations: requests.map((request) => {
            if (request.url.startsWith("https://"))
              return request.image
                ? { kind: "image", remote: true, url: request.url }
                : { kind: "external-url", url: request.url };
            if (request.url === "next.md" && !request.image)
              return {
                kind: "local-file",
                hostId: "remote",
                target:
                  source === "host"
                    ? { kind: "host", hostId: "remote", path: "/notes/next.md" }
                    : source === "thread-storage"
                      ? { kind: "thread-storage", threadId: "thread", path: "reports/next.md" }
                      : { kind: "workspace", environmentId: "env", path: "reports/next.md" },
              };
            if (["picture.png", "escape.png"].includes(request.url) && request.image)
              return {
                kind: "image",
                remote: false,
                url: `/api/v1/plugins/markdown-reader/http/image?asset=fixture-${generation}-${request.url.replace(".", "_")}`,
              };
            return { kind: "rejected", reason: "Unsafe or unsupported fixture destination" };
          }),
        };
      },
    },
    openUrl: () => true,
    openFilePreview: () => true,
  },
);
if (params.get("panel") === "viewport") {
  document.getElementById("root")!.style.height = "100dvh";
  slot.container.style.height = "100%";
}
document.getElementById("root")!.append(slot.container);
Object.assign(window, {
  destinationFixture: {
    inspection: slot.inspection,
    unmount: () => slot.lifecycle.unmount(),
    text,
  },
});
