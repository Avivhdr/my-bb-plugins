import { useMemo } from "react";
import {
  createDocumentModel,
  MarkdownDocument,
  type MarkdownDocumentProps,
} from "@bb-plugins/markdown-document";

type Props = Omit<MarkdownDocumentProps, "model"> & { text: string; namespace: string };

export function ModelDocument({ text, namespace, outline = true, ...props }: Props) {
  const model = useMemo(() => createDocumentModel(text, namespace), [text, namespace]);
  return <MarkdownDocument {...props} model={model} outline={outline} />;
}
