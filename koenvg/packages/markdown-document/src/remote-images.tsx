import { useEffect, useState } from "react";
import { ImagePresentation } from "./image-preview.js";

type Asset = Readonly<{ src: string; release: () => void }>;
const imageLimit = 4 * 1024 * 1024;
const documentLimit = 16 * 1024 * 1024;
export class RemoteImages {
  private active = 0;
  private requests = 0;
  private bytes = 0;
  private queue = new Set<() => void>();
  private controllers = new Set<AbortController>();
  private assets = new Set<() => void>();

  async load(url: string, signal: AbortSignal): Promise<Asset> {
    if (new URL(url).origin === window.location.origin || ++this.requests > 32)
      throw new Error("Image denied");
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    let size = 0;
    let acquired = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          if (controller.signal.aborted) {
            this.queue.delete(ready);
            reject(new Error("Image cancelled"));
          } else if (this.active < 4) {
            this.queue.delete(ready);
            this.active++;
            acquired = true;
            resolve();
          }
        };
        this.queue.add(ready);
        controller.signal.addEventListener("abort", ready, { once: true });
        ready();
      });
      const response = await fetch(url, {
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: controller.signal,
      });
      const type = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
      if (
        !response.ok ||
        !response.body ||
        !["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(type) ||
        Number(response.headers.get("content-length")) > imageLimit
      ) {
        await response.body?.cancel();
        throw new Error("Image unavailable");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (
            controller.signal.aborted ||
            size + value.byteLength > imageLimit ||
            this.bytes + value.byteLength > documentLimit
          ) {
            await reader.cancel();
            throw new Error("Image limit");
          }
          size += value.byteLength;
          this.bytes += value.byteLength;
          chunks.push(new Uint8Array(value));
        }
      } finally {
        reader.releaseLock();
      }
      if (controller.signal.aborted) throw new Error("Image cancelled");
      const src = URL.createObjectURL(new Blob(chunks, { type }));
      const retained = size;
      size = 0;
      const release = () => {
        if (!this.assets.delete(release)) return;
        URL.revokeObjectURL(src);
        this.bytes -= retained;
      };
      this.assets.add(release);
      return { src, release };
    } finally {
      this.bytes -= size;
      signal.removeEventListener("abort", abort);
      this.controllers.delete(controller);
      if (acquired) this.active--;
      for (const ready of this.queue) ready();
    }
  }
  dispose() {
    for (const controller of this.controllers) controller.abort();
    for (const release of this.assets) release();
  }
}
export function RemoteImage({
  url,
  alt,
  resources,
}: {
  url: string;
  alt: string;
  resources: RemoteImages;
}) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let current: Asset | null = null;
    setAsset(null);
    setBroken(false);
    void resources
      .load(url, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) loaded.release();
        else {
          current = loaded;
          setAsset(loaded);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setBroken(true);
      });
    return () => {
      controller.abort();
      current?.release();
    };
  }, [url, resources]);
  const label = alt || "Image";
  return asset && !broken ? (
    <ImagePresentation
      key={asset.src}
      source={{ kind: "owned-blob", src: asset.src }}
      alt={label}
      onInlineError={() => {
        asset.release();
        setBroken(true);
      }}
    />
  ) : (
    <span role="img" aria-label={label}>
      {label}
      {broken ? " (image unavailable)" : ""}
    </span>
  );
}
