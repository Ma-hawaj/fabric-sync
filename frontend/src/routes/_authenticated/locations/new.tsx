import { createFileRoute } from '@tanstack/react-router'
import { LocationFormPage } from '@/features/locations/location-form'

export const Route = createFileRoute('/_authenticated/locations/new')({
  staticData: { title: 'Add Location' },
  component: LocationFormPage,
})
