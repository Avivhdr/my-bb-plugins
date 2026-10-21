import type { ExperimentalLiveFileTarget } from "@get-bb/plugin-sdk/app";

export const MAX_DESTINATIONS = 128;
export const MAX_IMAGES = 32;
export const MAX_DESTINATION_URL_LENGTH = 4096;
export interface DestinationRequest {
  url: string;
  image: boolean;
}
export type Destination =
  | { kind: "fragment"; fragment: string }
  | { kind: "local-file"; target: ExperimentalLiveFileTarget; hostId: string }
  | { kind: "external-url"; url: string }
  | { kind: "image"; url: string; remote: boolean }
  | { kind: "rejected"; reason: string };
export interface DestinationResult {
  identity: { hostId: string; rootPath: string; documentPath: string } | null;
  destinations: Destination[];
}
export const destinationKey = ({ url, image }: DestinationRequest) => JSON.stringify([image, url]);
