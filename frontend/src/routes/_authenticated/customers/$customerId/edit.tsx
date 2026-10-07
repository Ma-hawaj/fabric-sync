import { createFileRoute } from '@tanstack/react-router'
import { CustomerFormPage } from '@/features/customers/customer-form'

export const Route = createFileRoute(
  '/_authenticated/customers/$customerId/edit',
)({
  staticData: { title: 'Edit Customer' },
  component: EditCustomerRoute,
})

function EditCustomerRoute() {
  const { customerId } = Route.useParams()
  return <CustomerFormPage customerId={customerId} />
}
