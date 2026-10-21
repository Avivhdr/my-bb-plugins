export function patchIdentity(patch: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < patch.length; index++) {
    hash ^= patch.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${patch.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
