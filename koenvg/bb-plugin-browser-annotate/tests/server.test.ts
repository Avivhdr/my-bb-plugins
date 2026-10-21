// @vitest-environment node
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "browser-annotate" });
  disposers.push(() => harness.lifecycle.dispose());
  plugin(bb);
  const call = (method: string, input: unknown) =>
    harness.behavior.callRpc(method, input) as Promise<any>;
  const provider = harness.inspection.registrations.mentionProviders.find(
    (registered) => registered.id === "annotation",
  )!;
  return { harness, call, provider };
}

const createInput = {
  threadId: "thr",
  number: 1,
  url: "https://example.com/page#top",
  kind: "button",
  comment: "Too much padding",
  rect: { x: 10, y: 20, width: 100, height: 40 },
  isFixed: false,
  viewport: { width: 1440, height: 900 },
  imageBase64: JPEG,
};

describe("annotation RPC", () => {
  it("creates an annotation with a pill label and lists it by URL and thread", async () => {
    const { call } = setup();

    const created = await call("create", createInput);

    expect(created).toMatchObject({
      number: 1,
      label: "1 · button",
      urlKey: "https://example.com/page",
    });
    expect(created).not.toHaveProperty("imagePath");
    expect(
      await call("listForUrl", { threadId: "thr", url: "https://example.com/page#other" }),
    ).toHaveLength(1);
    expect(await call("listForThread", { threadId: "thr" })).toHaveLength(1);
    expect(await call("listForThread", { threadId: "other" })).toEqual([]);
  });

  it.each([
    ["a blank comment", { comment: "   " }],
    ["a comment over 4000 characters", { comment: "x".repeat(4001) }],
    ["an image that is not a JPEG", { imageBase64: Buffer.from("png").toString("base64") }],
    ["a thread id with a path", { threadId: "../x" }],
  ])("rejects %s", async (_name, override) => {
    const { call } = setup();

    await expect(call("create", { ...createInput, ...override })).rejects.toThrow();
  });

  it("updates a comment only within its thread", async () => {
    const { call } = setup();
    const { id } = await call("create", createInput);

    await expect(call("update", { threadId: "other", id, comment: "x" })).rejects.toThrow(
      "Unknown annotation",
    );
    await expect(
      call("update", { threadId: "thr", id: "missing", comment: "x" }),
    ).rejects.toThrow();
    await expect(call("update", { threadId: "thr", id, comment: " " })).rejects.toThrow();
    expect(await call("update", { threadId: "thr", id, comment: "Less padding" })).toMatchObject({
      comment: "Less padding",
    });
  });

  it("removes an annotation of its own thread and ignores unknown ids", async () => {
    const { call } = setup();
    const { id } = await call("create", createInput);

    expect(await call("remove", { threadId: "other", id })).toEqual({ removed: [] });
    expect(await call("remove", { threadId: "thr", id: "missing" })).toEqual({ removed: [] });
    expect(await call("remove", { threadId: "thr", id })).toEqual({ removed: [id] });
    expect(await call("listForThread", { threadId: "thr" })).toEqual([]);
  });

  it("rejects a number that is not the next one", async () => {
    const { call } = setup();
    await call("create", createInput);

    await expect(call("create", createInput)).rejects.toThrow("Save again");
    expect(await call("listForThread", { threadId: "thr" })).toHaveLength(1);
  });

  it("publishes a change for each mutation", async () => {
    const { call, harness } = setup();
    const { id } = await call("create", createInput);
    await call("update", { threadId: "thr", id, comment: "x" });
    await call("remove", { threadId: "thr", id });

    expect(
      harness.inspection.realtimeSignals.filter(
        (signal) => signal.channel === "annotations:changed",
      ),
    ).toHaveLength(3);
  });
});

describe("annotation mention provider", () => {
  it("is hidden from the mention menu", async () => {
    const { provider } = setup();

    expect(
      await provider.search({ trigger: "@", query: "", projectId: null, threadId: "thr" } as never),
    ).toEqual([]);
  });

  it("gives the agent the image and the comment at send time", async () => {
    const { call, provider } = setup();
    const { id } = await call("create", createInput);
    await call("update", { threadId: "thr", id, comment: "Use 8px padding" });

    const resolved = await provider.resolve(id);

    expect(resolved.context).toContain("Browser annotation 1");
    expect(resolved.context).toContain("URL: https://example.com/page#top");
    expect(resolved.context).toContain("Viewport: 1440 x 900 CSS px");
    expect(resolved.context).toContain("Use 8px padding");
    expect(resolved.context).toContain("not part of the page");
    expect(resolved.context).not.toMatch(/selector|<[a-z]+[ >]|computed style|\.tsx?:/i);
    expect(resolved.experimental_images).toEqual([
      expect.objectContaining({ type: "localImage", path: expect.stringMatching(/thr\/.+\.jpg$/) }),
    ]);
  });

  it("sends the text with a note when the image is missing", async () => {
    const { call, provider } = setup();
    const { id } = await call("create", createInput);
    const first = await provider.resolve(id);
    const image = first.experimental_images![0]!;
    if (image.type !== "localImage") throw new Error("Expected a local image.");
    await rm(image.path);

    const resolved = await provider.resolve(id);

    expect(resolved.context).toContain("screenshot for this annotation is not available");
    expect(resolved.experimental_images).toBeUndefined();
  });

  it("does not throw for a deleted annotation", async () => {
    const { provider } = setup();

    await expect(provider.resolve("gone")).resolves.toMatchObject({
      context: expect.stringContaining("deleted"),
    });
  });

  it("clears only the annotations that were sent and keeps their images for the sweep", async () => {
    const { call, provider } = setup();
    const sent = await call("create", createInput);
    const kept = await call("create", { ...createInput, number: 2 });
    const image = (await provider.resolve(sent.id)).experimental_images![0]!;
    if (image.type !== "localImage") throw new Error("Expected a local image.");

    expect(await call("clearResolved", { threadId: "thr" })).toEqual({ removed: [sent.id] });
    expect(
      (await call("listForThread", { threadId: "thr" })).map((found: { id: string }) => found.id),
    ).toEqual([kept.id]);
    expect(existsSync(image.path)).toBe(true);
  });

  it("deletes the image of an unsent annotation right away", async () => {
    const { call, provider } = setup();
    const unsent = await call("create", createInput);
    const probe = await call("create", { ...createInput, number: 2 });
    const image = (await provider.resolve(probe.id)).experimental_images![0]!;
    if (image.type !== "localImage") throw new Error("Expected a local image.");
    const unsentPath = image.path.replace(probe.id, unsent.id);
    expect(existsSync(unsentPath)).toBe(true);

    await call("remove", { threadId: "thr", id: unsent.id });

    expect(existsSync(unsentPath)).toBe(false);
  });
});
