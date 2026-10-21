import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../contract";
import {
  applyCreate,
  applyRelabel,
  applyRename,
  emptyHierarchy,
  type BoardCard,
  type BoardModel,
} from "../core/board";
import {
  modelFromIssuesBoard,
  patchBoardCardValue,
  patchBoardLabelColor,
  reconcilePendingCreatedCards,
} from "../core/boardModel";
import { normalizeLabelColor } from "../core/labelColors";
import type { IssuesConfig, RepoLabel, TicketDraft } from "../core/types";

export type IssuesRpc = PluginRpcClient<RpcContract>;

export interface RefineDraftRequest {
  text: string;
  draft: TicketDraft | null;
  feedback: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The board for one project, and every edit the view can make to it. Edits apply
 * optimistically, then refetch so the board settles on what GitHub holds.
 *
 * Each project switch starts a new generation. An async step that finishes after the
 * switch checks its generation and drops its result, so a slow response for the old
 * project never lands on the new one's board.
 */
export function useIssuesBoard(rpc: IssuesRpc, projectId: string | null) {
  const [board, setBoardState] = useState<BoardModel | null>(null);
  const [repoLabels, setRepoLabelsState] = useState<RepoLabel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mirrors of the latest state, for edits that derive the next board from the
  // current one inside async callbacks.
  const boardRef = useRef<BoardModel | null>(null);
  const repoLabelsRef = useRef<RepoLabel[]>([]);
  const pendingCreatedRef = useRef<BoardCard[]>([]);
  const activation = useRef<{ projectId: string | null; generation: number }>({
    projectId: null,
    generation: 0,
  });

  const setBoard = useCallback((next: BoardModel | null) => {
    boardRef.current = next;
    setBoardState(next);
  }, []);
  const setRepoLabels = useCallback((next: RepoLabel[]) => {
    repoLabelsRef.current = next;
    setRepoLabelsState(next);
  }, []);

  const isCurrent = (generation: number) => activation.current.generation === generation;

  const loadBoard = useCallback(async (): Promise<void> => {
    const { projectId: pid, generation } = activation.current;
    if (!pid) {
      setBoard(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const raw = await rpc.call("issues_get_board", { projectId: pid });
      if (!isCurrent(generation)) return;
      const reconciliation = reconcilePendingCreatedCards(
        modelFromIssuesBoard(raw),
        raw,
        pendingCreatedRef.current,
      );
      setRepoLabels(raw.labels);
      pendingCreatedRef.current = reconciliation.pendingCards;
      setBoard(reconciliation.board);
    } catch (cause) {
      if (!isCurrent(generation)) return;
      setBoard(null);
      setError(errorMessage(cause));
    } finally {
      if (isCurrent(generation)) setIsLoading(false);
    }
  }, [rpc, setBoard, setRepoLabels]);

  useEffect(() => {
    activation.current = {
      projectId,
      generation: activation.current.generation + 1,
    };
    setBoard(null);
    setRepoLabels([]);
    pendingCreatedRef.current = [];
    setError(null);
    setBusy(false);
    setIsLoading(false);
    void loadBoard();
  }, [projectId, loadBoard, setBoard, setRepoLabels]);

  /** Run an edit with the busy flag up. Resolves true when it succeeded for this project. */
  const withBusy = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    const { generation } = activation.current;
    setError(null);
    setBusy(true);
    try {
      await operation();
      return isCurrent(generation);
    } catch (cause) {
      if (isCurrent(generation)) setError(errorMessage(cause));
      return false;
    } finally {
      if (isCurrent(generation)) setBusy(false);
    }
  }, []);

  /** The project and generation an edit runs against, or null with no board loaded. */
  const target = () => {
    const { projectId: pid, generation } = activation.current;
    return pid && boardRef.current ? { projectId: pid, generation } : null;
  };

  const setValue = useCallback(
    async (issueNumber: number, value: number | null): Promise<void> => {
      const t = target();
      if (!t || !boardRef.current) return;
      setBoard(patchBoardCardValue(boardRef.current, issueNumber, value));
      await withBusy(async () => {
        await rpc.call("issues_set_value", { projectId: t.projectId, issueNumber, value });
      });
    },
    [rpc, setBoard, withBusy],
  );

  const saveText = useCallback(
    async (issueNumber: number, title: string, body: string): Promise<boolean> => {
      const t = target();
      if (!t || !boardRef.current) return false;
      if (title) setBoard(applyRename(boardRef.current, issueNumber, title));
      return withBusy(async () => {
        await rpc.call("issues_edit_issue", {
          projectId: t.projectId,
          number: issueNumber,
          ...(title ? { title } : {}),
          body,
        });
        if (isCurrent(t.generation)) await loadBoard();
      });
    },
    [rpc, setBoard, withBusy, loadBoard],
  );

  /**
   * Move a card between columns: remove `fromLabel`, add `toLabel` (either may be ''
   * for the "no curated label" / Other column). Cards sort by value and issue number,
   * so there is no position within a column to persist.
   */
  const moveCard = useCallback(
    async (issueNumber: number, fromLabel: string, toLabel: string): Promise<void> => {
      const t = target();
      if (!t || !boardRef.current || fromLabel === toLabel) return;
      setBoard(applyRelabel(boardRef.current, issueNumber, fromLabel, toLabel));
      await withBusy(async () => {
        await rpc.call("issues_edit_issue", {
          projectId: t.projectId,
          number: issueNumber,
          addLabels: toLabel ? [toLabel] : [],
          removeLabels: fromLabel ? [fromLabel] : [],
        });
        if (isCurrent(t.generation)) await loadBoard();
      });
    },
    [rpc, setBoard, withBusy, loadBoard],
  );

  const toggleLabel = useCallback(
    (issueNumber: number, name: string, currentlyOn: boolean): Promise<void> =>
      currentlyOn ? moveCard(issueNumber, name, "") : moveCard(issueNumber, "", name),
    [moveCard],
  );

  const closeIssue = useCallback(
    async (issueNumber: number): Promise<boolean> => {
      const t = target();
      if (!t) return false;
      return withBusy(async () => {
        await rpc.call("issues_edit_issue", {
          projectId: t.projectId,
          number: issueNumber,
          state: "closed",
        });
      });
    },
    [rpc, withBusy],
  );

  const createIssue = useCallback(
    async (title: string, body: string, labels: string[]): Promise<boolean> => {
      const t = target();
      if (!t) return false;
      return withBusy(async () => {
        const { issue } = await rpc.call("issues_create_issue", {
          projectId: t.projectId,
          title,
          body,
          labels,
        });
        if (!isCurrent(t.generation)) return;
        const card: BoardCard = {
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels.map((label) => label.name),
          value: null,
          threadLink: null,
          ...emptyHierarchy(),
        };
        pendingCreatedRef.current = [
          ...pendingCreatedRef.current.filter((pending) => pending.issueNumber !== card.issueNumber),
          card,
        ];
        if (boardRef.current) setBoard(applyCreate(boardRef.current, card));
        // No refetch here: GitHub's issue listing is eventually consistent. A later
        // load reconciles pending cards once the listing includes the new issue.
      });
    },
    [rpc, setBoard, withBusy],
  );

  const refineTicketDraft = useCallback(
    async (request: RefineDraftRequest): Promise<TicketDraft> => {
      const { projectId: pid } = activation.current;
      if (!pid) throw new Error("Select a project before refining a ticket.");
      return rpc.call("issues_refine_ticket", {
        projectId: pid,
        repo: boardRef.current?.repo ?? "",
        repoLabels: repoLabelsRef.current.map((label) => label.name),
        ...request,
      });
    },
    [rpc],
  );

  /** Start a thread on the issue. Resolves with the thread id, or null on failure. */
  const startThread = useCallback(
    async (card: BoardCard): Promise<string | null> => {
      const t = target();
      if (!t) return null;
      let threadId: string | null = null;
      await withBusy(async () => {
        const result = await rpc.call("issues_start_thread", {
          projectId: t.projectId,
          issueNumber: card.issueNumber,
          title: card.title,
        });
        threadId = result.threadId;
        // Reload so the card shows its new thread chip and the thread filter sees it.
        if (isCurrent(t.generation)) await loadBoard();
      });
      return threadId;
    },
    [rpc, withBusy, loadBoard],
  );

  const recolorLabel = useCallback(
    async (name: string, rawColor: string): Promise<void> => {
      const { projectId: pid, generation } = activation.current;
      if (!pid) return;
      const color = normalizeLabelColor(rawColor);
      if (!color) {
        setError("Label color must be a six-digit hex color.");
        return;
      }

      const previousBoard = boardRef.current;
      const previousLabels = repoLabelsRef.current;
      setRepoLabels(previousLabels.map((label) => (label.name === name ? { ...label, color } : label)));
      if (previousBoard) setBoard(patchBoardLabelColor(previousBoard, name, color));
      setBusy(true);
      try {
        await rpc.call("issues_update_label_color", { projectId: pid, name, color });
        if (isCurrent(generation)) await loadBoard();
      } catch (cause) {
        if (isCurrent(generation)) {
          setBoard(previousBoard);
          setRepoLabels(previousLabels);
          setError(errorMessage(cause));
        }
        throw cause;
      } finally {
        if (isCurrent(generation)) setBusy(false);
      }
    },
    [rpc, setBoard, setRepoLabels, loadBoard],
  );

  const loadColumnConfig = useCallback(async (): Promise<IssuesConfig | null> => {
    const { projectId: pid, generation } = activation.current;
    if (!pid) return null;
    setError(null);
    try {
      const config = await rpc.call("issues_get_config", { projectId: pid });
      return isCurrent(generation) ? config : null;
    } catch (cause) {
      if (isCurrent(generation)) setError(errorMessage(cause));
      return null;
    }
  }, [rpc]);

  const saveColumns = useCallback(
    async (labels: string[]): Promise<boolean> => {
      const { projectId: pid, generation } = activation.current;
      if (!pid) return false;
      return withBusy(async () => {
        await rpc.call("issues_set_column_labels", { projectId: pid, labels });
        if (isCurrent(generation)) await loadBoard();
      });
    },
    [rpc, withBusy, loadBoard],
  );

  const setRepo = useCallback(
    async (repo: string | null): Promise<boolean> => {
      const { projectId: pid, generation } = activation.current;
      if (!pid) return false;
      return withBusy(async () => {
        await rpc.call("issues_set_repo", { projectId: pid, repo });
        if (isCurrent(generation)) await loadBoard();
      });
    },
    [rpc, withBusy, loadBoard],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    board,
    repoLabels,
    repoSlug: board?.repo ?? "",
    isLoading,
    error,
    busy,
    loadBoard,
    setValue,
    saveText,
    toggleLabel,
    moveCard,
    closeIssue,
    createIssue,
    refineTicketDraft,
    startThread,
    recolorLabel,
    loadColumnConfig,
    saveColumns,
    setRepo,
    clearError,
  };
}

export type IssuesBoardController = ReturnType<typeof useIssuesBoard>;
