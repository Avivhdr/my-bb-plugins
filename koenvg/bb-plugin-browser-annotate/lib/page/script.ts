import { ANNOTATOR_GLOBAL, installAnnotator, type AnnotatorApi } from "./annotator";

export function annotatorInstallScript(): string {
  return `((${installAnnotator.toString()})(window, (message) => bb.postMessage(message)), true)`;
}

export function annotatorCallScript<M extends keyof AnnotatorApi>(
  method: M,
  ...args: Parameters<AnnotatorApi[M]>
): string {
  const encoded = args.map((arg) => JSON.stringify(arg)).join(", ");
  return `(async () => {
    const api = window.${ANNOTATOR_GLOBAL};
    if (!api) return false;
    await api.${method}(${encoded});
    return true;
  })()`;
}
