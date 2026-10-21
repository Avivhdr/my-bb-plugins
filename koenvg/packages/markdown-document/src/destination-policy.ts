export type SourceDestination = Readonly<{ host: string; path: string; fragment?: string }>;
type Permissions = Readonly<{
  localFragments?: boolean;
  openExternal?: (url: string) => boolean | Promise<boolean>;
  remoteImages?: boolean;
}>;
export type DestinationPolicy =
  | Readonly<{ kind: "deny" }>
  | (Permissions & Readonly<{ kind: "attachment"; binding?: never; activateSource?: never }>)
  | (Permissions &
      Readonly<{
        kind: "bound-source";
        binding: Readonly<{ root: string; host: string; documentPath: string }>;
        activateSource: (destination: SourceDestination) => boolean | Promise<boolean>;
      }>);
export type Destination =
  | { kind: "denied" }
  | { kind: "fragment"; fragment: string }
  | { kind: "external"; url: string }
  | { kind: "source"; destination: SourceDestination };
const denied: Destination = { kind: "denied" };

function decode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (/[\p{Cc}\p{Cf}\\]/u.test(decoded) || value.trim() !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}
function pathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root === "/" ? "/" : `${root}/`);
}
function absolutePath(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}
export function destination(value: string, policy: DestinationPolicy): Destination {
  const decoded = decode(value);
  if (decoded === null || !value || policy.kind === "deny") return denied;
  if (value.startsWith("#")) {
    return policy.localFragments && decoded.length > 1
      ? { kind: "fragment", fragment: decoded.slice(1).normalize("NFC") }
      : denied;
  }
  if (/^https?:\/\/[^/]/i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.hostname || url.username || url.password) return denied;
      return { kind: "external", url: url.href };
    } catch {
      return denied;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("//")) return denied;
  if (policy.kind !== "bound-source" || /[%?:]/.test(decoded) || /%(?:2f|23|3f|3a|40)/i.test(value))
    return denied;
  const { root, host, documentPath } = policy.binding;
  if (
    !host ||
    !/^[\w.-]+$/.test(host) ||
    decode(root) !== root ||
    decode(documentPath) !== documentPath
  )
    return denied;
  const canonicalRoot = absolutePath(root);
  const canonicalDocument = absolutePath(documentPath);
  if (!canonicalRoot || !canonicalDocument || !pathWithin(canonicalDocument, canonicalRoot))
    return denied;
  const [path, fragment] = decoded.split("#");
  if (!path || decoded.split("#").length > 2) return denied;
  const resolved = absolutePath(
    path.startsWith("/")
      ? path
      : `${canonicalDocument.slice(0, canonicalDocument.lastIndexOf("/"))}/${path}`,
  );
  if (!resolved || !pathWithin(resolved, canonicalRoot)) return denied;
  return {
    kind: "source",
    destination: { host, path: resolved, ...(fragment ? { fragment } : {}) },
  };
}
