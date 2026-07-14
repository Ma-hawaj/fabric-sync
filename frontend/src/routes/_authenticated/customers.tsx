import { createFileRoute } from '@tanstack/react-router'
import { CustomersPage } from '@/features/customers/customers'

export const Route = createFileRoute('/_authenticated/customers')({
  staticData: { title: 'Customers' },
  component: CustomersPage,
})
