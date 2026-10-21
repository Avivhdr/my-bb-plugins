import type { Annotation } from "./annotation";

export function annotationContext(annotation: Annotation, hasImage: boolean): string {
  return [
    `Browser annotation ${annotation.number}`,
    `URL: ${annotation.url}`,
    `Viewport: ${Math.round(annotation.viewport.width)} x ${Math.round(annotation.viewport.height)} CSS px`,
    "Comment:",
    annotation.comment,
    "",
    hasImage
      ? `The attached screenshot shows the marked area. The black and white box and the number ${annotation.number} are an annotation overlay drawn by BB. They are not part of the page.`
      : "The screenshot for this annotation is not available.",
  ].join("\n");
}

export const MISSING_ANNOTATION_CONTEXT =
  "This browser annotation was deleted before the message was sent.";

export const UNREADABLE_ANNOTATION_CONTEXT = "This browser annotation could not be loaded.";
