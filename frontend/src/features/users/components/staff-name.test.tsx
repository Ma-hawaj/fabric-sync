import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { User } from '../types/user'
import { STAFF_USER } from '../test-fixtures'
import { StaffName } from './staff-name'

function renderName(userId: string | null, users?: User[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (users) client.setQueryData(['users'], users)
  return render(
    <QueryClientProvider client={client}>
      <StaffName userId={userId} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('StaffName', () => {
  it('resolves the audit subject to a name with the email available for identification', () => {
    renderName(STAFF_USER.id, [STAFF_USER])
    expect(screen.getByText(STAFF_USER.name).getAttribute('title')).toBe(
      STAFF_USER.email,
    )
    expect(screen.queryByText(STAFF_USER.id)).toBeNull()
  })

  it('uses email when the directory has no display name', () => {
    renderName(STAFF_USER.id, [{ ...STAFF_USER, name: ' ' }])
    expect(screen.getByText(STAFF_USER.email!)).toBeTruthy()
  })

  it('explains when a historic user is absent without displaying the raw subject', () => {
    renderName('removed-user-id', [])
    expect(screen.getByText('Staff member unavailable')).toBeTruthy()
    expect(screen.queryByText('removed-user-id')).toBeNull()
  })

  it('resolves an uncached name through the existing directory endpoint', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: [STAFF_USER] })
    renderName(STAFF_USER.id)
    expect(screen.getByText('Loading staff name…')).toBeTruthy()
    expect(await screen.findByText(STAFF_USER.name)).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/users')
  })

  it('keeps a readable fallback when directory lookup fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new Error('Directory unavailable'),
    )
    renderName('unresolved-user-id')
    expect(await screen.findByText('Staff directory unavailable')).toBeTruthy()
    expect(screen.queryByText('unresolved-user-id')).toBeNull()
  })

  it('does not fetch the directory when no actor was recorded', () => {
    const get = vi.spyOn(apiClient, 'get')
    renderName(null)
    expect(screen.getByText('Staff not recorded')).toBeTruthy()
    expect(get).not.toHaveBeenCalled()
  })

  it('shares a single directory request between multiple staff labels', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: [STAFF_USER] })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StaffName userId={STAFF_USER.id} />
        <StaffName userId={STAFF_USER.id} />
      </QueryClientProvider>,
    )
    expect(await screen.findAllByText(STAFF_USER.name)).toHaveLength(2)
    expect(get).toHaveBeenCalledOnce()
  })
})
