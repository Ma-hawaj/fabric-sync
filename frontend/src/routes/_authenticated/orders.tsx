import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { OrdersPage } from '@/features/orders/orders'

// Lets a link from elsewhere — the invoice details sheet's tailoring lines —
// open a specific order's tracking sheet on load.
const ordersSearchSchema = z.object({
  trackOrderId: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/orders')({
  staticData: { title: 'Orders' },
  validateSearch: ordersSearchSchema,
  component: OrdersPage,
})
