// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hideHostPrStrip } from "./hide-host-pr-strip";

const PR_LINK = '<a id="pr" aria-label="Pull request 44: Open"><span>PR #44</span></a>';
const MERGE_GROUP =
  '<div id="merge" data-promptbox-hide-tiny=""><div><button>Merge</button><button aria-label="Choose pull request merge method"></button></div></div>';
const FILES_TOGGLE = '<button id="files" aria-controls="git-body">3 files</button>';

function renderStrip(...items: string[]) {
  document.body.innerHTML = `<section id="strip" aria-label="Thread context before sending"><div>${items.join("")}</div></section>`;
}

function isHidden(id: string) {
  return getComputedStyle(document.getElementById(id)!).display === "none";
}

async function mount() {
  const dispose = await hideHostPrStrip.mount({
    pluginId: "github-insight",
    generation: 1,
    signal: new AbortController().signal,
  });
  return dispose ?? (() => {});
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("hideHostPrStrip", () => {
  it("hides the whole strip when it only holds the PR link and merge button", async () => {
    renderStrip(PR_LINK, MERGE_GROUP);
    await mount();

    expect(isHidden("strip")).toBe(true);
  });

  it("keeps the changed files toggle and hides only the PR link and merge button", async () => {
    renderStrip(PR_LINK, FILES_TOGGLE, MERGE_GROUP);
    await mount();

    expect(isHidden("strip")).toBe(false);
    expect(isHidden("files")).toBe(false);
    expect(isHidden("pr")).toBe(true);
    expect(isHidden("merge")).toBe(true);
  });

  it("shows the strip again after unmount", async () => {
    renderStrip(PR_LINK, MERGE_GROUP);
    const dispose = await mount();
    await dispose();

    expect(isHidden("strip")).toBe(false);
  });
});
