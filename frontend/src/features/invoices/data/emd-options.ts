/**
 * The EMD (embroidery) choices for an order, matching the workbook's EMD
 * column: numbered designs 1–22 plus the named styles. Stored on the order
 * as-is, like the other design slots — a legacy free-text value that matches
 * none of these still prints as text.
 */
function numberedEmdOptions(): readonly string[] {
  return Array.from({ length: 22 }, (_, index) => String(index + 1))
}

export const EMD_OPTIONS: readonly string[] = [
  ...numberedEmdOptions(),
  'Zik Zak',
  'B.H.TV',
  'Bisht',
  'Q.Q.Q Sayed',
  'Q.Q.Q TV',
]
