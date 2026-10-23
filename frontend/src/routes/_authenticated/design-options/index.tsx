import { createFileRoute } from '@tanstack/react-router'
import { DesignOptionsPage } from '@/features/design-options/design-options'

export const Route = createFileRoute('/_authenticated/design-options/')({
  component: DesignOptionsPage,
})
