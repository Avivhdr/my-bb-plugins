const SUMMARY_WRITTEN_CHANNEL = "github-insight.summary-written";

export function announceSummaryWritten(threadId: string): void {
  const channel = new BroadcastChannel(SUMMARY_WRITTEN_CHANNEL);
  channel.postMessage({ threadId });
  channel.close();
}
