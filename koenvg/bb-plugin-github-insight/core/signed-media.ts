const ASSET_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSET_URL = new RegExp(`https://github\\.com/user-attachments/assets/(${ASSET_ID})`, "g");
const BARE_ASSET_LINE = new RegExp(
  `^[ \\t]*https://github\\.com/user-attachments/assets/(${ASSET_ID})[ \\t]*$`,
  "gm",
);
const MEDIA_TAG = /<(img|video)\b[^>]*?(?<![\w-])src="([^"]+)"/g;
const SIGNED_HOST = "https://private-user-images.githubusercontent.com/";
const EXPIRY_MARGIN_MS = 60_000;

interface SignedMedia {
  url: string;
  video: boolean;
  expiresAt: number;
}

export type SignMedia = (markdown: string, html: string) => string;

function expiresAt(url: URL): number {
  try {
    const payload = url.searchParams.get("jwt")?.split(".")[1] ?? "";
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function signedMediaOf(html: string): Map<string, SignedMedia> {
  const media = new Map<string, SignedMedia>();
  for (const [, tag, src] of html.matchAll(MEDIA_TAG)) {
    const url = src.replaceAll("&amp;", "&");
    if (!url.startsWith(SIGNED_HOST)) continue;
    const parsed = new URL(url);
    const assetId = parsed.pathname.match(ASSET_ID)?.[0];
    if (assetId !== undefined)
      media.set(assetId, { url, video: tag === "video", expiresAt: expiresAt(parsed) });
  }
  return media;
}

function withMedia(markdown: string, media: ReadonlyMap<string, SignedMedia>): string {
  return markdown
    .replace(BARE_ASSET_LINE, (line, assetId: string) => {
      const signed = media.get(assetId);
      return signed?.video === true
        ? `<video src="${signed.url.replaceAll("&", "&amp;")}" controls></video>`
        : line;
    })
    .replace(ASSET_URL, (url, assetId: string) => media.get(assetId)?.url ?? url);
}

export function createMediaSigner(now: () => number): SignMedia {
  const known = new Map<string, SignedMedia>();
  const isFresh = (media: SignedMedia) => media.expiresAt - EXPIRY_MARGIN_MS > now();
  return (markdown, html) => {
    const media = signedMediaOf(html);
    if (media.size === 0) return markdown;
    for (const [assetId, kept] of known) if (!isFresh(kept)) known.delete(assetId);
    for (const [assetId, signed] of media) {
      const kept = known.get(assetId);
      if (kept !== undefined) media.set(assetId, kept);
      else known.set(assetId, signed);
    }
    return withMedia(markdown, media);
  };
}
