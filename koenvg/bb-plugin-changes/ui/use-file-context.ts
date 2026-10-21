import { useEffect, useId, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { parsePatchFiles, processFile, type FileDiffMetadata } from "@pierre/diffs";
import type { rpcContract } from "../contract";
import {
  ContextError,
  contextFailure,
  textRevisions,
  validateContext,
  validateText,
  type ContextFailure,
  type Snapshot,
} from "../core/text-context";

export type ContextState =
  | { kind: "idle" }
  | { kind: "loading"; snapshot: Snapshot; requestId: number }
  | { kind: "ready"; snapshot: Snapshot; diff: FileDiffMetadata }
  | { kind: "failed"; snapshot: Snapshot; error: ContextFailure };
const IDLE: ContextState = { kind: "idle" };

type Session = {
  key: string | null;
  snapshot: Snapshot | null;
  state: ContextState;
  requestId: number;
};

export function useFileContext(snapshot: Snapshot | null) {
  const rpc = useRpc<typeof rpcContract>();
  const id = useId();
  const key = snapshot === null ? null : JSON.stringify(snapshot);
  const session = useRef<Session>({ key, snapshot, state: IDLE, requestId: 0 });
  if (session.current.key !== key) session.current = { key, snapshot, state: IDLE, requestId: 0 };
  const [published, setPublished] = useState<{
    session: Session;
    state: ContextState;
  } | null>(null);
  if (published !== null && published.session !== session.current) setPublished(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current.requestId++;
    };
  }, []);

  async function activate() {
    const source = session.current;
    const captured = source.snapshot;
    if (
      !captured ||
      source.state.kind === "loading" ||
      source.state.kind === "ready" ||
      (source.state.kind === "failed" && source.state.error.code !== "read")
    )
      return;
    const requestId = ++source.requestId;
    const current = () =>
      mounted.current && session.current === source && source.requestId === requestId;
    const publish = (state: ContextState) => {
      if (!current()) return;
      source.state = state;
      setPublished({ session: source, state });
    };
    publish({ kind: "loading", snapshot: captured, requestId });
    try {
      const result = await rpc.call("getTextContext", {
        threadId: captured.threadId,
        basis: captured.basis,
        file: captured.file,
        patch: captured.patch,
      });
      if (!current()) return;
      const texts = validateContext(captured, result);
      let original: FileDiffMetadata[];
      let diff: FileDiffMetadata | undefined;
      try {
        original = parsePatchFiles(captured.patch, undefined, true).flatMap((entry) => entry.files);
        diff = processFile(captured.patch, {
          oldFile: { name: captured.file.previousPath ?? captured.file.path, contents: texts.old },
          newFile: { name: captured.file.path, contents: texts.new },
          throwOnError: true,
          cacheKey: `context-${id}-${captured.generation}-${requestId}`,
        });
      } catch {
        throw new ContextError("unsupported", "Context could not be displayed. Refresh changes.");
      }
      if (
        original.length !== 1 ||
        !diff ||
        diff.isPartial !== false ||
        diff.name !== captured.file.path ||
        diff.name !== original[0]!.name ||
        diff.prevName !== original[0]!.prevName ||
        diff.type !== original[0]!.type ||
        diff.hunks.map((hunk) => hunk.hunkSpecs).join("") !==
          original[0]!.hunks.map((hunk) => hunk.hunkSpecs).join("") ||
        diff.additionLines.join("") !== texts.new ||
        diff.deletionLines.join("") !== texts.old
      )
        throw new ContextError("unsupported", "Context could not be displayed. Refresh changes.");
      publish({ kind: "ready", snapshot: captured, diff });
    } catch (error) {
      publish({ kind: "failed", snapshot: captured, error: contextFailure(error) });
    }
  }
  return {
    state: published?.session === session.current ? published.state : IDLE,
    activate: () => void activate(),
  };
}

export function contextEligibility(
  snapshot: Snapshot | null,
  diff: FileDiffMetadata | null,
): string | null {
  if (!snapshot || !diff?.isPartial || diff.hunks.length === 0) return "";
  try {
    textRevisions(snapshot.basis, snapshot.file);
    validateText(snapshot.patch, new TextEncoder().encode(snapshot.patch).length);
    return null;
  } catch (error) {
    return contextFailure(error).message;
  }
}

// BB's diff renderer exposes pointer-only div buttons. Keep its native expansion behavior.
export function prepareContextControls(node: HTMLElement): void {
  const root = node.shadowRoot;
  root?.querySelectorAll<HTMLElement>("[data-expand-button]").forEach((button) => {
    button.tabIndex = 0;
    button.setAttribute(
      "aria-label",
      button.hasAttribute("data-expand-all-button")
        ? "Expand all unchanged lines"
        : button.hasAttribute("data-expand-down")
          ? "Expand unchanged lines above"
          : button.hasAttribute("data-expand-up")
            ? "Expand unchanged lines below"
            : "Expand unchanged lines",
    );
    button.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.repeat) return;
      const index = Array.from(root.querySelectorAll("[data-expand-button]")).indexOf(button);
      button.click();
      const controls = root.querySelectorAll<HTMLElement>("[data-expand-button]");
      controls[Math.min(index, controls.length - 1)]?.focus();
    };
  });
}
