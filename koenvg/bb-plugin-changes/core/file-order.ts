export function compareFilePaths(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const leftIsFolder = index < left.length - 1;
    const rightIsFolder = index < right.length - 1;
    if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1;
    if (left[index] !== right[index]) return left[index]!.localeCompare(right[index]!);
  }
  return 0;
}
