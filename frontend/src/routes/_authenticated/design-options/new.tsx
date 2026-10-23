import { createFileRoute } from '@tanstack/react-router'
import { DesignOptionFormPage } from '@/features/design-options/design-option-form'

export const Route = createFileRoute('/_authenticated/design-options/new')({
  staticData: { title: 'New' },
  component: DesignOptionFormPage,
})
