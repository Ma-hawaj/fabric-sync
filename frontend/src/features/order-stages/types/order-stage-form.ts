import type { OrderStage } from './order-stage'

export interface OrderStageFormValues {
  name: string
  sortOrder: number | ''
  requiresDelivery: boolean
  isActive: boolean
}

export function createEmptyOrderStageForm(): OrderStageFormValues {
  return { name: '', sortOrder: '', requiresDelivery: false, isActive: true }
}

export function orderStageToFormValues(
  stage: OrderStage,
): OrderStageFormValues {
  return {
    name: stage.name,
    sortOrder: stage.sortOrder,
    requiresDelivery: stage.requiresDelivery,
    isActive: stage.isActive,
  }
}
