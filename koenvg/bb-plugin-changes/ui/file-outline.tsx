import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { DiffStat } from "../../review-ui/diff-stat";
import type { ChangedFile } from "../core/changes";
import { buildFileTree, visibleRows, type FileTreeRow } from "../core/file-tree";
import { FileTypeIcon } from "./file-icons/file-type-icon";
import { getFileIconName } from "./file-icons/icon-map";
import { OUTLINE_WIDTH, useOutlineWidth } from "./use-outline-width";

type OutlineWidth = ReturnType<typeof useOutlineWidth>;

interface FileOutlineProps {
  files: readonly ChangedFile[];
  commentCounts: ReadonlyMap<string, number>;
  current: string | null;
  onSelect: (path: string) => void;
}

const INDENT_PX = 16;
const ROW_START_PX = 8;
const CHEVRON_GAP_PX = 6;

export function FileOutline({ files, commentCounts, current, onSelect }: FileOutlineProps) {
  const rows = useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const nav = useRef<HTMLElement>(null);
  const outline = useOutlineWidth();
  const navId = useId();
  useEffect(() => {
    if (current !== null && nav.current !== null) revealRow(nav.current, current);
  }, [current]);

  function toggle(path: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  return (
    <div
      className="relative hidden shrink-0 border-r border-border @3xl:flex"
      style={{ width: outline.width, maxWidth: "calc(100% - 400px)" }}
    >
      <nav ref={nav} id={navId} aria-label="Files" className="min-w-0 flex-1 overflow-y-auto py-1">
        <ul>
          {shown.map((row) => (
            <li
              key={row.kind === "folder" ? `folder:${row.path}` : row.file.path}
              className="relative"
            >
              <IndentGuides depth={row.depth} />
              {row.kind === "folder" ? (
                <FolderRow
                  row={row}
                  open={!collapsed.has(row.path)}
                  onToggle={() => toggle(row.path)}
                />
              ) : (
                <FileRow
                  row={row}
                  commentCount={commentCounts.get(row.file.path) ?? 0}
                  current={row.file.path === current}
                  onSelect={() => onSelect(row.file.path)}
                />
              )}
            </li>
          ))}
        </ul>
      </nav>
      <ResizeHandle outline={outline} controls={navId} />
    </div>
  );
}

function ResizeHandle({ outline, controls }: { outline: OutlineWidth; controls: string }) {
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = renderedWidth(event.currentTarget);
    drag.current = { startX: event.clientX, startWidth, width: startWidth };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    drag.current.width = drag.current.startWidth + event.clientX - drag.current.startX;
    outline.preview(drag.current.width);
  }

  function endDrag() {
    if (drag.current === null) return;
    outline.commit(drag.current.width);
    drag.current = null;
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0;
    if (step === 0) return;
    event.preventDefault();
    outline.commit(renderedWidth(event.currentTarget) + step);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file outline"
      aria-controls={controls}
      aria-valuemin={OUTLINE_WIDTH.min}
      aria-valuemax={OUTLINE_WIDTH.max}
      aria-valuenow={outline.width}
      tabIndex={0}
      data-dragging={dragging}
      className="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize touch-none transition-colors duration-150 hover:bg-ring/40 focus-visible:bg-ring/60 focus-visible:outline-none data-[dragging=true]:bg-ring/60 motion-reduce:transition-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={outline.reset}
      onKeyDown={onKeyDown}
    />
  );
}

function renderedWidth(handle: HTMLElement): number {
  return handle.parentElement!.getBoundingClientRect().width;
}

const ROW =
  "flex h-[26px] w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-sm hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50";

function FolderRow({
  row,
  open,
  onToggle,
}: {
  row: Extract<FileTreeRow, { kind: "folder" }>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={row.label}
      title={row.path}
      className={cn(ROW, "text-muted-foreground")}
      style={{ paddingLeft: rowStart(row.depth) }}
      onClick={onToggle}
    >
      <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-4 shrink-0" />
      <FileTypeIcon name={open ? "folder-open" : "folder"} />
      <span className="min-w-0 flex-1 truncate">
        {row.label.split("/").map((part, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <span aria-hidden className="px-1 opacity-50">
                /
              </span>
            )}
            <span>{part}</span>
          </Fragment>
        ))}
      </span>
    </button>
  );
}

function FileRow({
  row,
  commentCount,
  current,
  onSelect,
}: {
  row: Extract<FileTreeRow, { kind: "file" }>;
  commentCount: number;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      title={row.file.path}
      data-path={row.file.path}
      aria-current={current ? "true" : undefined}
      className={cn(ROW, "aria-[current=true]:bg-state-active")}
      style={{ paddingLeft: rowStart(row.depth) + INDENT_PX + CHEVRON_GAP_PX }}
      onClick={onSelect}
    >
      <FileTypeIcon name={getFileIconName(row.file.path)} />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      <CommentCount count={commentCount} />
      <StatusBadge status={row.file.status} />
      <DiffStat additions={row.file.additions} deletions={row.file.deletions} />
    </button>
  );
}

function IndentGuides({ depth }: { depth: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      aria-hidden
      data-indent-guide
      className="pointer-events-none absolute inset-y-0 w-px bg-border"
      style={{ left: rowStart(level) + INDENT_PX / 2 }}
    />
  ));
}

const STATUS: Record<ChangedFile["status"], { letter: string; label: string; className: string }> =
  {
    added: { letter: "A", label: "Added", className: "text-success" },
    modified: { letter: "M", label: "Modified", className: "text-attention" },
    deleted: { letter: "D", label: "Deleted", className: "text-destructive" },
    renamed: { letter: "R", label: "Renamed", className: "text-muted-foreground" },
    copied: { letter: "C", label: "Copied", className: "text-muted-foreground" },
    type_changed: { letter: "T", label: "Type changed", className: "text-muted-foreground" },
    untracked: { letter: "U", label: "Untracked", className: "text-success" },
  };

function StatusBadge({ status }: { status: ChangedFile["status"] }) {
  const { letter, label, className } = STATUS[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("w-3 shrink-0 text-center font-mono text-xs font-semibold", className)}
    >
      {letter}
    </span>
  );
}

function revealRow(nav: HTMLElement, path: string) {
  const row = nav.querySelector<HTMLElement>(`button[data-path="${CSS.escape(path)}"]`);
  if (row === null) return;
  const rowBox = row.getBoundingClientRect();
  const navBox = nav.getBoundingClientRect();
  if (rowBox.top < navBox.top || rowBox.bottom > navBox.bottom)
    row.scrollIntoView({ block: "nearest" });
}

function rowStart(depth: number): number {
  return ROW_START_PX + depth * INDENT_PX;
}

function CommentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
      <span aria-hidden className="inline-flex items-center gap-0.5">
        <Icon name="MessageSquare" className="size-3" />
        {count}
      </span>
      <span className="sr-only">{`${count} pending ${count === 1 ? "comment" : "comments"}`}</span>
    </span>
  );
}
