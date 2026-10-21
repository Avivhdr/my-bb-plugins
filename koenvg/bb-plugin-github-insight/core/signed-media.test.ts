import { describe, expect, it } from "vitest";
import { createMediaSigner } from "./signed-media";

const IMAGE_ID = "1bc7aa19-b5b1-40ea-95c8-ab8be878d7ba";
const VIDEO_ID = "5676ccda-f9b1-4eb5-b1b2-b5370588b2b5";
const asset = (id: string) => `https://github.com/user-attachments/assets/${id}`;

function jwtExpiringAt(seconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: seconds })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`;
}

function signed(id: string, ext: string, expSeconds = 2_000_000_000): string {
  return `https://private-user-images.githubusercontent.com/1/2-${id}.${ext}?jwt=${jwtExpiringAt(expSeconds)}`;
}

const html = [
  `<p><a href="${signed(IMAGE_ID, "png")}"><img src="${signed(IMAGE_ID, "png")}" alt="x"></a></p>`,
  `<video src="${signed(VIDEO_ID, "mov")}" data-canonical-src="${signed(VIDEO_ID, "mov")}" controls="controls"></video>`,
].join("\n");

const nowSeconds = 1_800_000_000;
const signOnce = (markdown: string, html: string) =>
  createMediaSigner(() => nowSeconds * 1000)(markdown, html);

describe("createMediaSigner", () => {
  it("swaps an image attachment for its signed URL", () => {
    const markdown = `| <img width="900" alt="before" src="${asset(IMAGE_ID)}" /> |`;

    expect(signOnce(markdown, html)).toBe(
      `| <img width="900" alt="before" src="${signed(IMAGE_ID, "png")}" /> |`,
    );
  });

  it("swaps a markdown image attachment for its signed URL", () => {
    expect(signOnce(`![shot](${asset(IMAGE_ID)})`, html)).toBe(
      `![shot](${signed(IMAGE_ID, "png")})`,
    );
  });

  it("turns a video attachment on its own line into a video player", () => {
    const markdown = `Demo:\n\n${asset(VIDEO_ID)}\n\nDone`;

    expect(signOnce(markdown, html)).toBe(
      `Demo:\n\n<video src="${signed(VIDEO_ID, "mov")}" controls></video>\n\nDone`,
    );
  });

  it("keeps an image attachment on its own line as a link", () => {
    expect(signOnce(asset(IMAGE_ID), html)).toBe(signed(IMAGE_ID, "png"));
  });

  it("decodes HTML entities in the signed URL", () => {
    const encoded = `<img src="https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?a=1&amp;b=2">`;

    expect(signOnce(asset(IMAGE_ID), encoded)).toBe(
      `https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?a=1&b=2`,
    );
  });

  it("keeps attachments that the HTML does not sign", () => {
    const markdown = `![shot](${asset(IMAGE_ID)})`;

    expect(signOnce(markdown, `<img src="${asset(IMAGE_ID)}">`)).toBe(markdown);
  });

  it("keeps the first signed URL of an attachment until it is about to expire", () => {
    let now = nowSeconds * 1000;
    const sign = createMediaSigner(() => now);
    const markdown = `![a](${asset(IMAGE_ID)})`;
    const first = signed(IMAGE_ID, "png", nowSeconds + 300);
    const second = signed(IMAGE_ID, "png", nowSeconds + 360);
    const third = signed(IMAGE_ID, "png", nowSeconds + 600);

    expect(sign(markdown, `<img src="${first}">`)).toBe(`![a](${first})`);
    expect(sign(markdown, `<img src="${second}">`)).toBe(`![a](${first})`);

    now = (nowSeconds + 250) * 1000;
    expect(sign(markdown, `<img src="${third}">`)).toBe(`![a](${third})`);
  });

  it("uses each new URL when the expiry cannot be read", () => {
    const sign = createMediaSigner(() => nowSeconds * 1000);
    const markdown = asset(IMAGE_ID);
    const first = `https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?jwt=bad`;
    const second = `https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?jwt=worse`;

    sign(markdown, `<img src="${first}">`);

    expect(sign(markdown, `<img src="${second}">`)).toBe(second);
  });
});
