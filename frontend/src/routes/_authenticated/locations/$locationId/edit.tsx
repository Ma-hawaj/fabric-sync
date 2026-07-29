import { createFileRoute } from '@tanstack/react-router'
import { LocationFormPage } from '@/features/locations/location-form'

export const Route = createFileRoute(
  '/_authenticated/locations/$locationId/edit',
)({
  staticData: { title: 'Edit Location' },
  component: EditLocationRoute,
})

function EditLocationRoute() {
  const { locationId } = Route.useParams()
  return <LocationFormPage locationId={locationId} />
}
