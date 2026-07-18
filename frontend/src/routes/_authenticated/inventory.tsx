import { createFileRoute } from '@tanstack/react-router'
import { InventoryPage } from '@/features/inventory/inventory'

export const Route = createFileRoute('/_authenticated/inventory')({
  staticData: { title: 'Inventory' },
  component: InventoryPage,
})
