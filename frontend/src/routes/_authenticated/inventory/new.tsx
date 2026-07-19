import { createFileRoute } from '@tanstack/react-router'
import { InventoryFormPage } from '@/features/inventory/inventory-form'

export const Route = createFileRoute('/_authenticated/inventory/new')({
  staticData: { title: 'Add Stock' },
  component: InventoryFormPage,
})
