// Value badges are colored by priority band, so the highest-value issues stand
// out at a glance: red for the top band, orange for the middle, yellow for the
// bottom. Bands mirror the 1..10 scale offered in CardDrawer. Hex is returned
// without a leading '#' so callers can feed it straight into color-mix(), the
// same convention labelColors.ts uses for label swatches.
const VALUE_BAND_RED = 'dc2626'
const VALUE_BAND_ORANGE = 'f97316'
const VALUE_BAND_YELLOW = 'eab308'

export function valueBandColor(value: number): string {
  if (value >= 7) return VALUE_BAND_RED
  if (value >= 4) return VALUE_BAND_ORANGE
  return VALUE_BAND_YELLOW
}
