import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CHANGED_CHANNEL,
  MAX_IMAGE_BYTES,
  MENTION_PROVIDER_ID,
  pillLabel,
  type Annotation,
} from "./lib/annotation";
import {
  annotationContext,
  MISSING_ANNOTATION_CONTEXT,
  UNREADABLE_ANNOTATION_CONTEXT,
} from "./lib/agent-context";
import { rpcContract } from "./lib/contract";
import { createImageStore } from "./lib/images";
import { ANNOTATION_MIGRATIONS, createAnnotationStore, type StoredAnnotation } from "./lib/store";

// BB may read a sent image after the send, for example for a queued message,
// so the files of sent annotations outlive their rows.
export const SENT_IMAGE_GRACE_MS = 60 * 60 * 1000;

function toAnnotation({
  imagePath: _imagePath,
  resolvedAt: _resolvedAt,
  ...annotation
}: StoredAnnotation): Annotation {
  return annotation;
}

function decodeJpeg(base64: string): Uint8Array {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The annotation image is too large.");
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("The annotation image must be a JPEG.");
  }
  return bytes;
}

type DatabaseListRow = { name: string; file: string };

function imageRoot(bb: BbPluginApi): string {
  const main = bb.storage
    .database()
    .prepare<[], DatabaseListRow>("PRAGMA database_list")
    .all()
    .find((database) => database.name === "main");
  if (!main?.file) throw new Error("Browser annotation images need a file-backed plugin database.");
  return join(dirname(main.file), "annotations");
}

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, ANNOTATION_MIGRATIONS);
  const store = createAnnotationStore(db);
  const images = createImageStore(imageRoot(bb));
  const changed = (threadId: string) => bb.realtime.publish(CHANGED_CHANNEL, { threadId });
  const sweep = () =>
    images.sweep(store.imagePaths(), Date.now() - SENT_IMAGE_GRACE_MS).catch(() => undefined);

  function owned(threadId: string, id: string): StoredAnnotation | null {
    const annotation = store.get(id);
    return annotation?.threadId === threadId ? annotation : null;
  }

  void sweep();

  bb.rpc.register(rpcContract, {
    async create({ imageBase64, ...input }) {
      const id = randomUUID();
      const imagePath = await images.write(input.threadId, id, decodeJpeg(imageBase64));
      try {
        const annotation = store.insert({ ...input, id, imagePath });
        changed(input.threadId);
        return { ...toAnnotation(annotation), label: pillLabel(annotation) };
      } catch (error) {
        await images.remove(imagePath);
        throw error;
      }
    },
    update({ threadId, id, comment }) {
      if (!owned(threadId, id)) throw new Error("Unknown annotation.");
      store.updateComment(id, comment);
      changed(threadId);
      return toAnnotation(store.get(id)!);
    },
    async remove({ threadId, id }) {
      const annotation = owned(threadId, id);
      if (!annotation) return { removed: [] };
      store.remove(id);
      if (annotation.resolvedAt === null) await images.remove(annotation.imagePath);
      changed(threadId);
      return { removed: [id] };
    },
    listForUrl({ threadId, url }) {
      return store.listForUrl(threadId, url).map(toAnnotation);
    },
    listForThread({ threadId }) {
      return store.listForThread(threadId).map(toAnnotation);
    },
    clearResolved({ threadId }) {
      const removed = store.removeResolved(threadId);
      if (removed.length > 0) changed(threadId);
      void sweep();
      return { removed: removed.map((annotation) => annotation.id) };
    },
  });

  bb.ui.registerMentionProvider({
    id: MENTION_PROVIDER_ID,
    label: "Browser annotations",
    search: () => [],
    async resolve(id) {
      try {
        const annotation = store.get(id);
        if (!annotation) return { context: MISSING_ANNOTATION_CONTEXT };
        store.markResolved(id);
        const hasImage = await images.exists(annotation.imagePath);
        return {
          context: annotationContext(annotation, hasImage),
          ...(hasImage && {
            experimental_images: [
              {
                type: "localImage" as const,
                path: annotation.imagePath,
                context: `Screenshot for browser annotation ${annotation.number}`,
              },
            ],
          }),
        };
      } catch {
        return { context: UNREADABLE_ANNOTATION_CONTEXT };
      }
    },
  });
}
