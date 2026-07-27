import { createFileRoute } from '@tanstack/react-router'
import { LocationsPage } from '@/features/locations/locations'

export const Route = createFileRoute('/_authenticated/locations/')({
  staticData: { title: 'Locations' },
  component: LocationsPage,
})
