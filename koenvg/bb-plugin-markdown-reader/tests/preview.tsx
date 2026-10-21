import { useEffect, useState } from "react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type { LineRequest } from "@bb-plugins/markdown-document";
import { createRoot } from "react-dom/client";
import { Reader } from "../reader";
import type { ReaderTarget, ReadResult } from "../source";
import report from "./fixtures/report.md?raw";
import navigation from "./fixtures/navigation.md?raw";
import "../app.css";
import "./preview.css";

const target: ReaderTarget = {
  path: "reports/workspace.md",
  source: {
    kind: "workspace",
    threadId: null,
    environmentId: "fixture",
    projectId: "fixture",
    experimental_hostId: "fixture-host",
  },
};
const params = new URLSearchParams(location.search);
let reads = 0;
const text =
  params.get("document") === "navigation"
    ? navigation
    : params.get("document") === "footnotes"
      ? (params.get("headings") === "none" ? "" : "# Actual\r\n\r\n") +
        "Text[^1] and repeated[^1]\r\n\r\n[^1]: Note é.\r\n"
      : params.get("document") === "no-headings"
        ? "Plain text without headings.\r\n"
        : report;
const readDocument = async (): Promise<ReadResult> => {
  document.documentElement.dataset.fixtureReads = String(reads + 1);
  if (++reads > 1 && params.get("refresh") === "error")
    throw new Error("Fixture host disconnected. Retry when the host reconnects.");
  return {
    kind: "ready",
    snapshot: {
      text,
      sha256: "fixture",
      sizeBytes: new TextEncoder().encode(text).length,
      target,
      hostId: "fixture-host",
      rootPath: "/fixture",
      documentPath: "/fixture/reports/workspace.md",
      documentDirectory: "/fixture/reports",
    },
  };
};
const width = Number(params.get("width")) || 760;
document.documentElement.dataset.theme = params.get("theme") || "light";
// This event supplies new public line-range props, like a host navigation request.
function FixtureReader({ index = 0 }: { index?: number }) {
  const [lineRange, setLineRange] = useState<LineRequest>(() =>
    params.has("start")
      ? { startLineNumber: Number(params.get("start")), endLineNumber: Number(params.get("end")) }
      : null,
  );
  useEffect(() => {
    const request = (event: Event) => {
      const detail = (event as CustomEvent<{ reader?: number; range: LineRequest }>).detail;
      if ((detail.reader ?? 0) === index) setLineRange(detail.range);
    };
    window.addEventListener("fixture-line-request", request);
    return () => window.removeEventListener("fixture-line-request", request);
  }, [index]);
  return (
    <Reader
      target={target}
      readDocument={readDocument}
      lineRange={lineRange}
      Original={() => <p>Bound BB preview placeholder. No plugin selection occurs.</p>}
    />
  );
}
// The reader's host icons need the public SDK runtime even in this direct-render fixture.
installTestPluginRuntime();
createRoot(document.getElementById("root")!).render(
  <div className="fixture-layout">
    <aside className="fixture-outside" aria-label="Host style sentinel">
      <h2>Outside the reader</h2>
      <p>This text must keep the fixture host style.</p>
    </aside>
    <div
      className="fixture-panel"
      data-readers={params.get("readers")}
      style={{ width, maxWidth: "100%" }}
    >
      <FixtureReader />
      {params.get("readers") === "2" && <FixtureReader index={1} />}
    </div>
  </div>,
);
