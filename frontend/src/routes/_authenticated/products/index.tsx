import { createFileRoute } from '@tanstack/react-router'
import { ProductsPage } from '@/features/products/products'

export const Route = createFileRoute('/_authenticated/products/')({
  staticData: { title: 'Products' },
  component: ProductsPage,
})
