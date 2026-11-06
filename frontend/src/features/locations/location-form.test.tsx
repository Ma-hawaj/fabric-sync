import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { LocationFormPage } from './location-form'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { post },
  ApiError: class ApiError extends Error {},
}))
describe('location capabilities', () => {
  it('saves a production-only workshop without enabling stock or pickup', async () => {
    post.mockResolvedValue({
      data: {
        id: 'workshop',
        name: 'Workshop',
        receivesOrders: false,
        holdsStock: false,
        producesOrders: true,
        isActive: true,
      },
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LocationFormPage />
      </QueryClientProvider>,
    )
    fireEvent.change(screen.getByLabelText('Location Name'), {
      target: { value: 'Workshop' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Receives orders' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Holds stock' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Produces orders' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/locations', {
        name: 'Workshop',
        receivesOrders: false,
        holdsStock: false,
        producesOrders: true,
      }),
    )
  })
})
