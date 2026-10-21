import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createSourceReader,
  readResultSchema,
  targetSchema,
  destinationsInputSchema,
  destinationsResultSchema,
} from "./source";
import { hostContract } from "./host-contract";
import { createImageTransport } from "./images";

export const rpcContract = defineRpcContract({
  read_document: { input: targetSchema, output: readResultSchema },
  resolve_destinations: { input: destinationsInputSchema, output: destinationsResultSchema },
});

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const images = createImageTransport((target) => bb.sdk.files.read(target));
  bb.http.route("GET", "/image", (context) => images.serve(context.req.query("asset") ?? null), {
    auth: "local",
  });
  const reader = createSourceReader({
    environment: (environmentId) => bb.sdk.environments.get({ environmentId }),
    project: (projectId) => bb.sdk.projects.get({ projectId }),
    thread: (threadId) => bb.sdk.threads.get({ threadId }),
    storageLocation: (threadId) => bb.sdk.threads.storageLocation({ threadId }),
    resolveHostRoot: async ({ hostId, rootPath }) =>
      (await host.call("resolve_root", { rootPath }, { hostId })).rootPath,
    findByName: async ({ hostId, rootPath, name }) =>
      (await host.call("find_by_name", { rootPath, name }, { hostId })).paths,
    read: (target) => bb.sdk.files.read(target),
    imageUrl: images.urlFor,
  });
  bb.rpc.register(rpcContract, {
    read_document: (target) => reader.read(target),
    resolve_destinations: (input) => reader.destinations(input),
  });
}
