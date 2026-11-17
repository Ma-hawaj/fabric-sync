import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { AutoReplySettingsButton } from './auto-reply-settings'
import { autoReplySchema } from './lib/auto-reply-schema'
import type { AutoReplySettings } from './lib/auto-reply-schema'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))

const settings: AutoReplySettings = {
  enabled: false,
  message: '',
  cooldownHours: 24,
  maxPerMinute: 10,
  deliveryConfigured: true,
  button: null,
}

async function open(values: Partial<AutoReplySettings> = {}) {
  vi.mocked(apiClient.get).mockResolvedValue({
    data: { ...settings, ...values },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AutoReplySettingsButton />
    </QueryClientProvider>,
  )
  expect(apiClient.get).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Automatic reply' }))
  await screen.findByRole('checkbox', { name: 'Enable automatic replies' })
}

beforeEach(() => vi.clearAllMocks())

describe('automatic reply settings', () => {
  it('adds a contact button with an editable label and destination', async () => {
    await open({ message: 'Contact our shop.' })
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }))
    fireEvent.change(screen.getByLabelText('Button label'), {
      target: { value: 'Chat with us' },
    })
    fireEvent.change(screen.getByLabelText('Button destination URL'), {
      target: { value: 'https://wa.me/97333112233' },
    })
    const updated = {
      enabled: false,
      message: 'Contact our shop.',
      cooldownHours: 24,
      maxPerMinute: 10,
      button: { label: 'Chat with us', url: 'https://wa.me/97333112233' },
    }
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { ...updated, deliveryConfigured: true },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        '/notifications/auto-reply',
        updated,
      ),
    )
  })

  it('removes a saved button when saving settings', async () => {
    await open({
      message: 'Contact our shop.',
      button: { label: 'Website', url: 'https://example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove button' }))
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { ...settings, message: 'Contact our shop.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/notifications/auto-reply', {
        enabled: false,
        message: 'Contact our shop.',
        cooldownHours: 24,
        maxPerMinute: 10,
        button: null,
      }),
    )
  })

  it('ignores unsaved button removal when immediately disabling replies', async () => {
    const button = { label: 'Shop website', url: 'https://example.com' }
    await open({ enabled: true, message: 'Contact our shop.', button })
    fireEvent.click(screen.getByRole('button', { name: 'Remove button' }))
    expect(screen.queryByLabelText('Button label')).toBeNull()
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { ...settings, enabled: false, button },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off now' }))
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/notifications/auto-reply', {
        enabled: false,
        message: 'Contact our shop.',
        cooldownHours: 24,
        maxPerMinute: 10,
        button,
      }),
    )
  })

  it('validates link destinations and the shorter text limit with a button', () => {
    const button = { label: 'Help', url: 'https://wa.me/97333112233' }
    for (const url of [
      'javascript:alert(1)',
      'https:example.com',
      'https://user:pass@example.com',
      'https://example.com/a b',
    ]) {
      expect(
        autoReplySchema.safeParse({ ...settings, button: { ...button, url } })
          .success,
      ).toBe(false)
    }
    expect(
      autoReplySchema.safeParse({
        ...settings,
        button: { ...button, label: 'a'.repeat(21) },
      }).success,
    ).toBe(false)
    expect(
      autoReplySchema.safeParse({
        ...settings,
        button,
        message: 'a'.repeat(1025),
      }).success,
    ).toBe(false)
    expect(
      autoReplySchema.safeParse({
        ...settings,
        button: null,
        message: 'a'.repeat(4096),
      }).success,
    ).toBe(true)
  })

  it('saves reply text, enabled state, and rate limits', async () => {
    await open()
    const updated = {
      enabled: true,
      message: 'For help, contact +97333112233.',
      cooldownHours: 12,
      maxPerMinute: 5,
      button: null,
    }
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { ...updated, deliveryConfigured: true },
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable automatic replies' }),
    )
    fireEvent.change(screen.getByLabelText('Reply message'), {
      target: { value: updated.message },
    })
    fireEvent.change(
      screen.getByLabelText('Hours between replies per customer'),
      { target: { value: '12' } },
    )
    fireEvent.blur(screen.getByLabelText('Hours between replies per customer'))
    fireEvent.change(screen.getByLabelText('Maximum replies per minute'), {
      target: { value: '5' },
    })
    fireEvent.blur(screen.getByLabelText('Maximum replies per minute'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith(
        '/notifications/auto-reply',
        updated,
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('can immediately turn off without saving unsaved message edits', async () => {
    const original = {
      ...settings,
      enabled: true,
      message: 'Contact our shop.',
    }
    await open(original)
    vi.mocked(apiClient.put).mockResolvedValue({
      data: { ...original, enabled: false },
    })
    fireEvent.change(screen.getByLabelText('Reply message'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off now' }))
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/notifications/auto-reply', {
        enabled: false,
        message: original.message,
        cooldownHours: 24,
        maxPerMinute: 10,
        button: null,
      }),
    )
  })

  it('retains the form and explains a failed save', async () => {
    await open()
    vi.mocked(apiClient.put).mockRejectedValue(new Error('Unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('prevents enabling an empty message or unavailable delivery', async () => {
    await open({ deliveryConfigured: false })
    expect(
      screen.getByRole('checkbox').getAttribute('aria-disabled') === 'true' ||
        screen.getByRole('checkbox').hasAttribute('disabled'),
    ).toBe(true)
    expect(
      autoReplySchema.safeParse({ ...settings, enabled: true }).success,
    ).toBe(false)
    expect(
      autoReplySchema.safeParse({ ...settings, cooldownHours: 0 }).success,
    ).toBe(false)
    expect(
      autoReplySchema.safeParse({ ...settings, maxPerMinute: 61 }).success,
    ).toBe(false)
  })
})
