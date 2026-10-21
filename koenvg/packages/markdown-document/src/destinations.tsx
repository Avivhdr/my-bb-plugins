import { createContext, useContext, useState, type ReactNode } from "react";
import { ImagePresentation } from "./image-preview.js";
import {
  destination,
  type Destination,
  type DestinationPolicy as NativePolicy,
} from "./destination-policy.js";
import { RemoteImage, type RemoteImages } from "./remote-images.js";

export const MAX_DESTINATIONS = 128;
export const MAX_IMAGES = 32;
export const MAX_DESTINATION_URL_LENGTH = 4096;
export type DestinationRequest = Readonly<{ url: string; image: boolean }>;
export const destinationKey = ({ url, image }: DestinationRequest) => JSON.stringify([image, url]);
export type LinkReferences = Readonly<{
  children: ReactNode;
  id?: string;
  title?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}>;
export type DestinationGrant =
  | Readonly<{ kind: "rejected"; reason?: string }>
  | Readonly<{ kind: "fragment"; fragment: string }>
  | Readonly<{ kind: "bound-link"; render: (props: LinkReferences) => ReactNode }>
  | Readonly<{ kind: "image"; url: string; source: "remote" | "source" }>;
export type DestinationPolicy =
  | NativePolicy
  | Readonly<{ kind: "local-only" }>
  | Readonly<{
      kind: "delegated";
      resolve: (request: DestinationRequest) => DestinationGrant | undefined;
    }>;
export const denyDestinations: DestinationPolicy = Object.freeze({ kind: "deny" });
export const localDestinations: DestinationPolicy = Object.freeze({ kind: "local-only" });
type DestinationScope = Readonly<{
  policy: DestinationPolicy;
  requests: ReadonlySet<string>;
  resources: RemoteImages | null;
}>;
export const DestinationContext = createContext<DestinationScope>({
  policy: denyDestinations,
  requests: new Set(),
  resources: null,
});

export function checkedDestination(url: string, image: boolean): boolean {
  if (
    !url ||
    url.length > MAX_DESTINATION_URL_LENGTH ||
    url.trim() !== url ||
    Array.from(url).some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\",
    )
  )
    return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }
  if (
    Array.from(decoded).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\",
    ) ||
    /[\ud800-\udfff]/u.test(decoded) ||
    decoded.includes("%")
  )
    return false;
  if (url.startsWith("#")) return !image;
  const remote = /^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(url);
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) && !remote) return false;
  if (decoded.startsWith("/") || (!remote && decoded.includes("?"))) return false;
  const path = remote
    ? url.replace(/^https?:\/\/[^/?#]+/i, "").split(/[?#]/, 1)[0]!
    : url.split("#", 1)[0]!;
  if (
    /%2f|%5c/i.test(path) ||
    path
      .split("/")
      .some((part) => part.includes("%") && [".", ".."].includes(decodeURIComponent(part)))
  )
    return false;
  if (!remote) return !decodeURIComponent(path).includes(":");
  try {
    const parsed = new URL(url);
    return (
      !!parsed.hostname &&
      !parsed.username &&
      !parsed.password &&
      (!image || !/\.(svg|html?|pdf|tiff?)$/i.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function grant(scope: DestinationScope, url: string, image: boolean) {
  if (
    !checkedDestination(url, image) ||
    scope.policy.kind !== "delegated" ||
    !scope.requests.has(destinationKey({ url, image }))
  )
    return undefined;
  return scope.policy.resolve(Object.freeze({ url, image }));
}

function NativeLink({
  parsed,
  policy,
  children,
  ...references
}: LinkReferences & {
  parsed: Exclude<Destination, { kind: "fragment" }>;
  policy: NativePolicy;
}) {
  const [failed, setFailed] = useState(false);
  const open =
    parsed.kind === "external" && policy.kind !== "deny" ? policy.openExternal : undefined;
  const source =
    parsed.kind === "source" && policy.kind === "bound-source" ? policy.activateSource : undefined;
  if ((!open || parsed.kind !== "external") && (!source || parsed.kind !== "source"))
    return (
      <span {...references} className="mr-inert-link">
        {children}
      </span>
    );
  const activate = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      parsed.kind === "external" &&
      (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    )
      return;
    event.preventDefault();
    try {
      const result =
        parsed.kind === "external"
          ? await open!(parsed.url)
          : parsed.kind === "source"
            ? await source!(parsed.destination)
            : false;
      setFailed(!result);
    } catch {
      setFailed(true);
    }
  };
  return (
    <>
      <a
        {...references}
        href={parsed.kind === "external" ? parsed.url : undefined}
        role={parsed.kind === "source" ? "link" : undefined}
        tabIndex={parsed.kind === "source" ? 0 : undefined}
        onClick={activate}
        onAuxClick={parsed.kind === "source" ? activate : undefined}
        onKeyDown={(event) => {
          if (parsed.kind === "source" && event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      >
        {children}
      </a>
      {failed ? <span role="status">Link could not be opened.</span> : null}
    </>
  );
}

export function DestinationLink({
  url,
  fragmentTarget,
  children,
  ...references
}: LinkReferences & {
  url: string;
  fragmentTarget: (fragment: string) => string | null;
}) {
  const scope = useContext(DestinationContext);
  const { policy } = scope;
  const native = policy.kind === "attachment" || policy.kind === "bound-source" ? policy : null;
  const parsed =
    native &&
    checkedDestination(url, false) &&
    (url.startsWith("#") || scope.requests.has(destinationKey({ url, image: false })))
      ? destination(url, native)
      : null;
  const result = grant(scope, url, false);
  const local = native
    ? parsed?.kind === "fragment"
    : policy.kind !== "deny" && checkedDestination(url, false) && url.startsWith("#");
  const fragment = local
    ? parsed?.kind === "fragment"
      ? `#${encodeURIComponent(parsed.fragment)}`
      : url
    : result?.kind === "fragment"
      ? result.fragment
      : "";
  const target = fragmentTarget(fragment);
  if (target)
    return (
      <a {...references} href={`#${target}`} data-heading-target={target}>
        {children}
      </a>
    );
  if (native)
    return (
      <NativeLink
        {...references}
        policy={native}
        parsed={parsed?.kind === "fragment" ? { kind: "denied" } : parsed || { kind: "denied" }}
      >
        {children}
      </NativeLink>
    );
  if (result?.kind === "bound-link") return result.render({ ...references, children });
  return (
    <span
      {...references}
      className="mr-inert-link"
      title={result?.kind === "rejected" ? result.reason : undefined}
    >
      {children}
    </span>
  );
}

function LoadedImage({
  result,
  alt,
  title,
}: {
  result: Extract<DestinationGrant, { kind: "image" }>;
  alt: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="mr-image-placeholder">
        {alt || "Image"}
        <span className="mr-image-error"> Image unavailable. Refresh to retry.</span>
      </span>
    );
  return (
    <ImagePresentation
      key={result.url}
      source={{ kind: "delegated", src: result.url, source: result.source }}
      alt={alt}
      title={title}
      onInlineError={() => setFailed(true)}
    />
  );
}

export function DestinationImage({
  url,
  alt = "",
  title,
}: {
  url: string;
  alt?: string;
  title?: string;
}) {
  const scope = useContext(DestinationContext);
  const { policy, resources } = scope;
  if (policy.kind === "attachment" || policy.kind === "bound-source") {
    const parsed = url.length <= MAX_DESTINATION_URL_LENGTH ? destination(url, policy) : null;
    const eligible = policy.remoteImages && parsed?.kind === "external";
    const issued = scope.requests.has(destinationKey({ url, image: true }));
    return eligible && resources && issued && parsed?.kind === "external" ? (
      <RemoteImage key={parsed.url} url={parsed.url} alt={alt} resources={resources} />
    ) : (
      <span role="img" aria-label={alt || "Image"}>
        {alt || "Image"}
        {eligible && !issued ? " (image unavailable)" : ""}
      </span>
    );
  }
  const result = grant(scope, url, true);
  let allowed = false;
  if (result?.kind === "image") {
    if (
      result.source === "remote" &&
      checkedDestination(result.url, true) &&
      /^https?:\/\//i.test(result.url) &&
      /^https?:\/\//i.test(url)
    ) {
      const remote = new URL(result.url);
      allowed =
        remote.href === new URL(url).href &&
        (typeof location === "undefined" || remote.origin !== location.origin);
    } else if (
      result.source === "source" &&
      !/^[a-z][a-z\d+.-]*:/i.test(url) &&
      !url.startsWith("/")
    ) {
      allowed = /^\/(?!\/)[^\s\\#]+$/.test(result.url) && !/%(?:2f|5c|25)/i.test(result.url);
    }
  }
  return allowed && result?.kind === "image" ? (
    <LoadedImage key={result.url} result={result} alt={alt} title={title} />
  ) : (
    <span
      className="mr-image-placeholder"
      title={result?.kind === "rejected" ? result.reason : undefined}
    >
      {alt || "Image"}
    </span>
  );
}
