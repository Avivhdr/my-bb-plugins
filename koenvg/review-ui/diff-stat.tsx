export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </span>
  );
}
