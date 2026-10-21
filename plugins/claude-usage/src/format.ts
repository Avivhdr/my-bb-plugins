export function formatMoney(amount: number): string {
  if (amount >= 1000) return `$${Math.round(amount).toLocaleString('en-US')}`
  if (amount > 0 && amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

export function formatShare(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  const share = (part / whole) * 100
  return share < 1 && share > 0 ? '<1%' : `${Math.round(share)}%`
}

export function formatDayLabel(day: string): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  if (!year || !month || !dayOfMonth) return day
  return new Date(year, month - 1, dayOfMonth).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
