import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { DocumentModel } from "./model.js";
import type { DestinationPolicy } from "./destinations.js";
import type { DocumentView } from "./index.js";

type DisplayImage = Readonly<
  | { kind: "delegated"; src: string; source: "remote" | "source" }
  | { kind: "owned-blob"; src: string }
>;
type PresentationSession = Readonly<{
  model: DocumentModel;
  policy: DestinationPolicy;
  view: DocumentView;
}>;
const PreviewContext = createContext<{
  container: HTMLDivElement | null;
  session: PresentationSession;
} | null>(null);

export function ImagePreviewBoundary({
  model,
  policy,
  view,
  children,
}: PresentationSession & { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const session = useMemo(() => ({ model, policy, view }), [model, policy, view]);
  const value = useMemo(() => ({ container, session }), [container, session]);
  return (
    <PreviewContext.Provider value={value}>
      {children}
      <div ref={setContainer} className="mr-image-preview-host" />
    </PreviewContext.Provider>
  );
}

function requestAttributes(source: DisplayImage) {
  return {
    src: source.src,
    referrerPolicy: "no-referrer" as const,
    crossOrigin:
      source.kind === "delegated" && source.source === "remote"
        ? ("anonymous" as const)
        : undefined,
  };
}

export function ImagePresentation({
  source,
  alt,
  title,
  onInlineError,
}: {
  source: DisplayImage;
  alt: string;
  title?: string;
  onInlineError: () => void;
}) {
  const host = useContext(PreviewContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false);
  const [openedIn, setOpenedIn] = useState<PresentationSession | null>(null);
  useLayoutEffect(() => {
    let current = true;
    const element = image.current!;
    const decoded = () => {
      if (current) setReady(true);
    };
    const loaded = () => {
      if (element.decode) void element.decode().then(decoded, () => {});
      else decoded();
    };
    element.addEventListener("load", loaded);
    if (element.complete && element.naturalWidth > 0) loaded();
    return () => {
      current = false;
      element.removeEventListener("load", loaded);
    };
  }, []);
  const close = () => {
    dialog.current?.close();
    setOpenedIn(null);
  };
  const label = alt || "Image";
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mr-image-trigger"
        aria-label={`Enlarge image: ${label}`}
        aria-haspopup="dialog"
        disabled={!ready}
        onClick={() => host && setOpenedIn(host.session)}
      >
        <img
          ref={image}
          {...requestAttributes(source)}
          alt={alt}
          title={title}
          loading={source.kind === "delegated" ? "lazy" : undefined}
          onError={() => {
            close();
            setReady(false);
            onInlineError();
          }}
        />
      </button>
      {host?.container && ready && openedIn === host.session
        ? createPortal(
            <ImageDialog
              source={source}
              label={label}
              dialog={dialog}
              trigger={trigger}
              close={close}
            />,
            host.container,
          )
        : null}
    </>
  );
}

function ImageDialog({
  source,
  label,
  dialog,
  trigger,
  close,
}: {
  source: DisplayImage;
  label: string;
  dialog: RefObject<HTMLDialogElement | null>;
  trigger: RefObject<HTMLButtonElement | null>;
  close: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const dismiss = () => {
    const element = dialog.current;
    const ownedFocus = !!element?.contains(element.ownerDocument.activeElement);
    close();
    const button = trigger.current;
    if (
      ownedFocus &&
      button?.isConnected &&
      !button.disabled &&
      !button.closest("[inert], [hidden], [aria-hidden='true']") &&
      button.getClientRects().length
    )
      button.focus({ preventScroll: true });
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useLayoutEffect(() => {
    const element = dialog.current!;
    const ownerWindow = element.ownerDocument.defaultView!;
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.contains(element.ownerDocument.activeElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissRef.current();
    };
    ownerWindow.addEventListener("keydown", escape, true);
    return () => {
      ownerWindow.removeEventListener("keydown", escape, true);
      element.close();
    };
  }, [dialog]);
  const outside = (x: number, y: number) => {
    const rect = dialog.current!.getBoundingClientRect();
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
  };
  return (
    <dialog
      ref={dialog}
      className="mr-image-dialog"
      aria-label={`Image preview: ${label}`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          closeButton.current?.focus({ preventScroll: true });
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        backdrop.current =
          event.isPrimary && event.button === 0 && outside(event.clientX, event.clientY)
            ? event.pointerId
            : null;
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        const dismissBackdrop =
          backdrop.current === event.pointerId &&
          event.button === 0 &&
          outside(event.clientX, event.clientY);
        backdrop.current = null;
        if (dismissBackdrop) dismiss();
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        backdrop.current = null;
      }}
      onClick={(event) => event.stopPropagation()}
      onAuxClick={(event) => event.stopPropagation()}
    >
      <div className="mr-image-dialog-toolbar">
        <span>{label}</span>
        <button ref={closeButton} type="button" onClick={dismiss} aria-label="Close image preview">
          Close
        </button>
      </div>
      {failed ? (
        <p role="status">Image preview unavailable. Close and reopen to retry.</p>
      ) : (
        <img {...requestAttributes(source)} alt={label} onError={() => setFailed(true)} />
      )}
    </dialog>
  );
}
