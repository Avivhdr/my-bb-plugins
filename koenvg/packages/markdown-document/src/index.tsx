import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { ImagePreviewBoundary } from "./image-preview.js";
import { Outline, useWidePanel } from "./outline.js";
import { RawDocument } from "./raw.js";
import { RemoteImages } from "./remote-images.js";
import {
  DestinationContext,
  denyDestinations,
  destinationKey,
  type DestinationPolicy,
} from "./destinations.js";
import type { DocumentModel } from "./model.js";
import type { LineRequest } from "./source-lines.js";
export { createDocumentModel, type DocumentModel, type DocumentHeading } from "./model.js";
export {
  denyDestinations,
  localDestinations,
  type DestinationPolicy,
  type DestinationRequest,
  type DestinationGrant,
  type LinkReferences,
} from "./destinations.js";
export type { SourceDestination } from "./destination-policy.js";
export type { LineRequest } from "./source-lines.js";
export type DocumentView = "preview" | "raw";
export type DocumentNavigation = Readonly<{
  container?: RefObject<HTMLElement | null>;
  reveal: (target: HTMLElement) => void;
}>;
export type MarkdownDocumentProps = Readonly<{
  model: DocumentModel;
  view: DocumentView;
  destinations?: DestinationPolicy;
  outline?: boolean;
  lineRange?: LineRequest;
  annotateSourceLines?: boolean;
  navigation?: DocumentNavigation;
}>;

export function MarkdownDocument({
  model,
  view,
  destinations = denyDestinations,
  outline = false,
  lineRange,
  annotateSourceLines = false,
  navigation,
}: MarkdownDocumentProps) {
  const root = useRef<HTMLDivElement>(null);
  const wide = useWidePanel(navigation?.container ?? root);
  const imagePermission =
    (destinations.kind === "attachment" || destinations.kind === "bound-source") &&
    destinations.remoteImages === true;
  const resources = useMemo(() => new RemoteImages(), [model, imagePermission, view]);
  useEffect(() => () => resources.dispose(), [resources]);
  const scope = useMemo(
    () => ({
      policy: destinations,
      resources,
      requests: new Set(model.requests.map(destinationKey)),
    }),
    [model, destinations, resources],
  );
  const reveal = useCallback(
    (target: HTMLElement) => {
      if (navigation) navigation.reveal(target);
      else {
        const container = root.current;
        if (container && /^(auto|scroll)$/.test(getComputedStyle(container).overflowY)) {
          container.scrollTop +=
            target.getBoundingClientRect().top - container.getBoundingClientRect().top;
        }
        target.focus({ preventScroll: true });
      }
    },
    [navigation],
  );
  const navigate = (id: string) => {
    const target = Array.from(
      root.current?.querySelectorAll<HTMLElement>(".mr-prose [id]") ?? [],
    ).find((node) => node.id === id);
    if (target) reveal(target);
  };
  const activate = (event: React.MouseEvent<HTMLElement>) => {
    const anchor = (event.target as Element | null)?.closest?.("a[data-heading-target]");
    if (!anchor) return;
    event.preventDefault();
    if (event.button < 2) navigate(anchor.getAttribute("data-heading-target")!);
  };
  const showOutline =
    outline &&
    model.headings.length > 0 &&
    destinations.kind !== "deny" &&
    ((destinations.kind !== "attachment" && destinations.kind !== "bound-source") ||
      destinations.localFragments === true);
  return (
    <div
      ref={root}
      className="md-document"
      data-document-namespace={model.namespace}
      onClick={activate}
      onAuxClick={activate}
    >
      <DestinationContext.Provider value={scope}>
        <ImagePreviewBoundary model={model} policy={destinations} view={view}>
          {view === "raw" ? (
            <RawDocument
              sourceLines={model.sourceLines}
              request={lineRange}
              annotations={annotateSourceLines}
              reveal={reveal}
            />
          ) : (
            <div
              className="mr-document-layout"
              data-outline={showOutline ? (wide ? "aside" : "inline") : "hidden"}
            >
              {showOutline && !wide && <Outline model={model} wide={false} />}
              <article className="mr-prose" aria-label="Markdown preview">
                {model.content}
              </article>
              {showOutline && wide && <Outline model={model} wide />}
            </div>
          )}
        </ImagePreviewBoundary>
      </DestinationContext.Provider>
    </div>
  );
}
