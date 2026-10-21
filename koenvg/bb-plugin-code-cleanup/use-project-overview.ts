import { useEffect, useRef, useState, type RefObject } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ProjectState, ProjectSummary, SettingsContract } from "./rpc";
import { message } from "./use-project-settings";

/** Saved summaries are independent of the dialog's prompt baseline and draft. */
export function useProjectOverview(editorLock: RefObject<boolean>, editorPending: boolean) {
  const rpc = useRpc<SettingsContract>();
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<{ id: string; message: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const generation = useRef(0);
  const writeLock = useRef(false);
  const alive = useRef(false);
  const activeRead = useRef(false);
  const readAttempt = useRef(-1);
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);

  function refresh() {
    ++generation.current;
    setAttempt((n) => n + 1);
  }
  useRealtime("settings.changed", (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      "kind" in payload &&
      (payload.kind === "default" || payload.kind === "project")
    )
      refresh();
  });
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") refresh();
    previousConnection.current = connection;
  }, [connection]);
  useEffect(() => {
    alive.current = true;
    readAttempt.current = -1;
    return () => {
      alive.current = false;
      ++generation.current;
    };
  }, []);
  useEffect(() => {
    if (pending || editorPending || readAttempt.current === attempt) return;
    readAttempt.current = attempt;
    const request = ++generation.current;
    let current = true;
    let settled = false;
    activeRead.current = true;
    setReading(true);
    const valid = () => current && alive.current && generation.current === request;
    rpc
      .call("listProjectSummaries", {})
      .then((result) => {
        if (!valid()) return;
        setRows(result);
        setReadError(null);
      })
      .catch((error) => {
        if (valid()) setReadError(message(error));
      })
      .finally(() => {
        settled = true;
        if (valid()) {
          activeRead.current = false;
          setReading(false);
        }
      });
    return () => {
      current = false;
      if (!settled && readAttempt.current === attempt) readAttempt.current = -1;
    };
  }, [rpc, attempt, pending, editorPending]);

  async function persist(row: ProjectSummary, enabledOverride: boolean | null) {
    if (writeLock.current || editorLock.current || readError || !rows) return;
    const refreshAfter = activeRead.current;
    ++generation.current;
    writeLock.current = true;
    activeRead.current = false;
    setReading(false);
    setPending(row.id);
    setWriteError(null);
    setSaved(null);
    try {
      const state = await rpc.call("setEnablement", { projectId: row.id, enabledOverride });
      if (state.projectId !== row.id)
        throw new Error("Project response did not match the save target.");
      if (!alive.current) return;
      ++generation.current;
      setRows(
        (old) =>
          old?.map((item) =>
            item.id === row.id
              ? {
                  ...item,
                  enabled: state.enabled,
                  enabledOverride: state.enabledOverride,
                  promptSource: state.prompt === null ? "default" : "custom",
                }
              : item,
          ) ?? null,
      );
      setSaved(`Saved settings for ${row.name}.`);
    } catch (error) {
      if (alive.current) setWriteError({ id: row.id, message: message(error) });
    } finally {
      writeLock.current = false;
      if (alive.current) {
        setPending(null);
        if (refreshAfter) refresh();
      }
    }
  }
  function confirmPrompt(state: ProjectState) {
    ++generation.current;
    setRows(
      (old) =>
        old?.map((row) =>
          row.id === state.projectId
            ? { ...row, promptSource: state.prompt === null ? "default" : "custom" }
            : row,
        ) ?? null,
    );
    refresh();
  }
  return {
    rows,
    reading,
    readError,
    pending,
    writeError,
    saved,
    writeLock,
    refresh,
    persist,
    confirmPrompt,
  };
}
