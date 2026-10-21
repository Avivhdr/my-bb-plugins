import { createContext, useContext } from "react";

export interface PrTabSummary {
  files: number;
  unresolvedThreads: boolean;
}

const ReportSummaryContext = createContext<(summary: PrTabSummary | null) => void>(() => {});

export const ReportSummaryProvider = ReportSummaryContext.Provider;

export function useReportSummary(): (summary: PrTabSummary | null) => void {
  return useContext(ReportSummaryContext);
}
