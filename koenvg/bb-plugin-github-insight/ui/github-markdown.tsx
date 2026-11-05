import { useEffect, useRef } from "react";
import { Markdown, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { ImageWireResult } from "../core/image-content";
import { parseRepoImageUrl } from "../core/repo-image-url";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const MAX_CACHED = 40;
const cache = new Map<string, Promise<ImageWireResult>>();

/** One read per image URL while the app runs, also across re-renders and panels. */
function loadRepoImage(rpc: Rpc, url: string): Promise<ImageWireResult> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const loading = rpc
    .call("getRepoImage", { url })
    .catch((): ImageWireResult => ({ kind: "error", code: "read", message: "Could not load" }));
  // A failed read may work after a retry, so only a loaded image stays cached.
  loading.then((result) => result.kind !== "ready" && cache.delete(url));
  cache.set(url, loading);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return loading;
}

/**
 * bb's Markdown, plus images that are files in a GitHub repo (`github.com/<o>/<r>/raw/...`).
 * GitHub serves those only to a logged-in browser, so the plugin reads them with `gh` and swaps
 * the image source for the bytes.
 */
export function GithubMarkdown({ content, className }: { content: string; className?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    let live = true;
    const pending = new WeakMap<HTMLImageElement, string>();
    const swap = () => {
      for (const image of Array.from(element.querySelectorAll("img"))) {
        const src = image.getAttribute("src");
        if (src === null || pending.get(image) === src || parseRepoImageUrl(src) === null) continue;
        pending.set(image, src);
        void loadRepoImage(rpc, src).then((result) => {
          if (!live || image.getAttribute("src") !== src) return;
          if (result.kind === "ready") image.src = `data:${result.mime};base64,${result.content}`;
          else if (result.kind === "error") image.title = result.message;
        });
      }
    };
    swap();
    const observer = new MutationObserver(swap);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [rpc, content]);

  return (
    <div ref={root} className={className}>
      <Markdown content={content} />
    </div>
  );
}
