// One row of GET /order-stages — a step every order walks through in
// production. The list is staff-editable, which is why stages are rows rather
// than fixed values on an order's status.
export interface OrderStage {
  id: string
  name: string
  /** Position in the checklist. Gaps are fine; only the relative order counts. */
  sortOrder: number
  /**
   * Marks a stage that only applies when the garment changes location. On an
   * order produced at the branch the customer collects from, it is reported as
   * not applicable rather than left unfinished.
   */
  requiresDelivery: boolean
  isActive: boolean
}
