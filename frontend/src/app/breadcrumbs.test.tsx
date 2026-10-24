import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Breadcrumbs from '@/components/breadcrumbs'
import { routeTree } from '@/routeTree.gen'

// Exercise the production route hierarchy while rendering only its breadcrumbs.
routeTree.update({
  component: () => (
    <>
      <Breadcrumbs />
      <Outlet />
    </>
  ),
})

async function renderBreadcrumbs(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: {
      auth: {
        isAuthenticated: true,
        isLoading: false,
        user: null,
        error: null,
        signIn: async () => {},
        signOut: () => {},
      },
      queryClient: new QueryClient(),
    },
  })
  for (const route of Object.values(router.routesById)) {
    if (route.id !== '__root__' && !route.children?.length) {
      route.update({ component: () => null })
    }
  }
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

function breadcrumbLabels() {
  return within(screen.getByRole('navigation', { name: 'breadcrumb' }))
    .getAllByRole('link')
    .map((crumb) => crumb.textContent)
}

describe('route breadcrumbs', () => {
  it('shows Invoices / New and navigates back through the parent link', async () => {
    const router = await renderBreadcrumbs('/invoices/new')
    expect(breadcrumbLabels()).toEqual(['Invoices', 'New'])
    expect(document.querySelectorAll('[aria-current=page]')).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: 'New' }).getAttribute('aria-current'),
    ).toBe('page')
    const parent = screen.getByRole('link', { name: 'Invoices' })
    expect(parent.getAttribute('href')).toBe('/invoices')
    fireEvent.click(parent)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/invoices'),
    )
    await waitFor(() => expect(breadcrumbLabels()).toEqual(['Invoices']))
    expect(
      screen
        .getByRole('link', { name: 'Invoices' })
        .getAttribute('aria-current'),
    ).toBe('page')
  })

  it.each([
    ['/customers', 'Customers'],
    ['/products', 'Products'],
    ['/locations', 'Locations'],
    ['/invoices', 'Invoices'],
    ['/orders', 'Orders'],
    ['/inventory', 'Inventory'],
    ['/gift-cards', 'Gift Cards'],
    ['/order-stages', 'Order Stages'],
    ['/design-options', 'Design Options'],
    ['/users', 'Users'],
  ])('shows one current crumb on %s', async (path, label) => {
    await renderBreadcrumbs(path)
    expect(breadcrumbLabels()).toEqual([label])
  })

  it('redirects the old Add Stock URL to inventory with one current breadcrumb', async () => {
    const router = await renderBreadcrumbs('/inventory/new')
    expect(router.state.location.pathname).toBe('/inventory')
    expect(breadcrumbLabels()).toEqual(['Inventory'])
    expect(document.querySelectorAll('[aria-current=page]')).toHaveLength(1)
    expect(
      screen
        .getByRole('link', { name: 'Inventory' })
        .getAttribute('aria-current'),
    ).toBe('page')
  })

  it.each([
    ['/customers/new', 'Customers', 'New'],
    ['/products/new', 'Products', 'New'],
    ['/locations/new', 'Locations', 'New'],
    ['/order-stages/new', 'Order Stages', 'New'],
    ['/design-options/new', 'Design Options', 'New'],
    ['/gift-cards/new', 'Gift Cards', 'Issue Gift Card'],
    ['/customers/example/edit', 'Customers', 'Edit'],
    ['/products/example/edit', 'Products', 'Edit'],
    ['/locations/example/edit', 'Locations', 'Edit'],
    ['/order-stages/example/edit', 'Order Stages', 'Edit'],
    ['/design-options/example/edit', 'Design Options', 'Edit'],
    ['/invoices/example/edit', 'Invoices', 'Edit'],
    ['/invoices/example', 'Invoices', 'Invoice Details'],
    ['/orders/example', 'Orders', 'Order Details'],
  ])('includes the section on %s', async (path, section, page) => {
    await renderBreadcrumbs(path)
    expect(breadcrumbLabels()).toEqual([section, page])
    expect(document.querySelectorAll('[aria-current=page]')).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: section }).getAttribute('href'),
    ).toBe(`/${path.split('/')[1]}`)
    expect(
      screen.getByRole('link', { name: page }).getAttribute('aria-current'),
    ).toBe('page')
  })
})
