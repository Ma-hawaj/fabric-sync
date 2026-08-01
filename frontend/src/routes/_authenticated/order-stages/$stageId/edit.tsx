import { createFileRoute } from '@tanstack/react-router'
import { OrderStageFormPage } from '@/features/order-stages/order-stage-form'

export const Route = createFileRoute(
  '/_authenticated/order-stages/$stageId/edit',
)({
  staticData: { title: 'Edit Stage' },
  component: EditOrderStageRoute,
})

function EditOrderStageRoute() {
  const { stageId } = Route.useParams()
  return <OrderStageFormPage stageId={stageId} />
}
