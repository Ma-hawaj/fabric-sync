import { createFileRoute } from '@tanstack/react-router'
import { CustomerFormPage } from '@/features/customers/customer-form'

export const Route = createFileRoute('/_authenticated/customers/new')({
  staticData: { title: 'Add Customer' },
  component: CustomerFormPage,
})
