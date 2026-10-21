import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";
import { readWorkspaceVideo } from "./core/workspace-video";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: { readVideo: (request, context) => readWorkspaceVideo(request, context.signal) },
});
