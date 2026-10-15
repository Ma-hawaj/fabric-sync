import { createFileRoute } from '@tanstack/react-router'
import { DesignOptionFormPage } from '@/features/design-options/design-option-form'

export const Route = createFileRoute(
  '/_authenticated/design-options/$designOptionId/edit',
)({
  staticData: { title: 'Edit Option' },
  component: EditDesignOptionRoute,
})

function EditDesignOptionRoute() {
  const { designOptionId } = Route.useParams()
  return <DesignOptionFormPage optionId={designOptionId} />
}
