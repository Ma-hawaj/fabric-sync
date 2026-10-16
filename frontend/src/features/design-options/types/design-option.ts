// One row of GET /design-options — a single choice inside one of the fixed
// order design slots (thobe type, collar, sleeve, front/side pocket, patti,
// EMD). The slots themselves are still fixed order columns; only the options
// are rows, which is why staff can add and retire these without a deploy.
export type DesignCategory =
  | 'thob_type'
  | 'neck'
  | 'sleeve'
  | 'front_pocket'
  | 'side_pocket'
  | 'patti'
  | 'emd'

export interface DesignOption {
  id: string
  category: string
  /** The stored identity written onto an order. Immutable once created. */
  slug: string
  label: string
  /** Position inside its category picker. Gaps are fine. */
  sortOrder: number
  isActive: boolean
  hasImage: boolean
  /** Serves the illustration bytes (public — an `<img>` can't send auth). */
  imageUrl: string
}
