import { createFileRoute } from '@tanstack/react-router'
import { ProductFormPage } from '@/features/products/product-form'

export const Route = createFileRoute(
  '/_authenticated/products/$productId/edit',
)({
  staticData: { title: 'Edit Product' },
  component: EditProductRoute,
})

function EditProductRoute() {
  const { productId } = Route.useParams()
  return <ProductFormPage productId={productId} />
}
