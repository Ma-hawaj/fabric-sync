import { createFileRoute } from '@tanstack/react-router'
import { ProductFormPage } from '@/features/products/product-form'

export const Route = createFileRoute('/_authenticated/products/new')({
  staticData: { title: 'Add Product' },
  component: ProductFormPage,
})
