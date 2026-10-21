export type PrSubTab = "overview" | "files";

const selected = new Map<string, PrSubTab>();

export function rememberedSubTab(threadId: string): PrSubTab {
  return selected.get(threadId) ?? "overview";
}

export function rememberSubTab(threadId: string, subTab: PrSubTab): void {
  selected.set(threadId, subTab);
}

export function forgetSubTabs(): void {
  selected.clear();
}
