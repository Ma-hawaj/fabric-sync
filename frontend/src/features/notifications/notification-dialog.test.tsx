import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { NotificationDialog } from './notification-dialog'
import type { NotificationDraft, NotificationKind } from './types'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

function fixture(): NotificationDraft {
  return {
    id: 'draft-1',
    invoiceId: 'invoice-1',
    kind: 'manual_resend',
    state: 'draft',
    previewVersion: 'version-1',
    artifactId: 'pdf-1',
    canSend: true,
    snapshot: {
      invoiceNumber: 42,
      body: 'Your invoice INV-42 is attached. Balance due: 40.000 BHD.',
      language: 'en_US',
      exclusions: [],
    },
    recipients: [
      {
        id: 'recipient-1',
        normalizedMobile: '+97333112233',
        customers: [
          { id: 'a', name: 'Ahmed', mobileNo: '33112233', enabled: true },
          { id: 'b', name: 'Ali', mobileNo: '+973 3311 2233', enabled: true },
        ],
        selected: true,
        status: 'draft',
        errorMessage: null,
      },
      {
        id: 'recipient-2',
        normalizedMobile: '+97333991122',
        customers: [
          { id: 'c', name: 'Fatima', mobileNo: '33991122', enabled: true },
        ],
        selected: true,
        status: 'draft',
        errorMessage: null,
      },
    ],
  }
}
function mount(kind: NotificationKind = 'manual_resend', onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <NotificationDialog invoiceId="invoice-1" kind={kind} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('notification preview and approval', () => {
  let draft: NotificationDraft
  beforeEach(() => {
    vi.clearAllMocks()
    draft = fixture()
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:approved-pdf'),
        revokeObjectURL: vi.fn(),
      }),
    )
    vi.mocked(apiClient.get).mockResolvedValue({
      data: new Blob(['%PDF-approved'], { type: 'application/pdf' }),
    })
    vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
      if (String(path).endsWith('/selection')) {
        const input = body as { selectedMobiles: string[] }
        draft = {
          ...draft,
          previewVersion: 'version-2',
          recipients: draft.recipients.map((r) => ({
            ...r,
            selected: input.selectedMobiles.includes(r.normalizedMobile),
          })),
        }
      }
      if (String(path).endsWith('/send'))
        draft = { ...draft, state: 'approved' }
      return { data: draft }
    })
  })
  it('shows every customer grouped by unique mobile and only sends after explicit approval', async () => {
    mount()
    await screen.findByTitle('Invoice PDF preview')
    expect(screen.getByText(/2 unique mobiles selected/)).toBeTruthy()
    expect(screen.getByText(/Ahmed, Ali/)).toBeTruthy()
    const checkboxes = screen.getAllByRole<HTMLInputElement>('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes.every((box) => box.checked)).toBe(true)
    expect(
      vi
        .mocked(apiClient.post)
        .mock.calls.some(([path]) => String(path).endsWith('/send')),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/notifications/draft-1/send',
        {
          previewVersion: 'version-1',
          selectedMobiles: ['+97333112233', '+97333991122'],
        },
      ),
    )
    expect(apiClient.get).toHaveBeenCalledWith('/documents/pdf-1/content', {
      responseType: 'blob',
    })
  })
  it('persists a reviewed selection with a new version and permits deselecting every destination', async () => {
    mount()
    await screen.findByTitle('Invoice PDF preview')
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    await screen.findByText(/1 unique mobile selected/)
    expect(apiClient.post).toHaveBeenCalledWith(
      '/notifications/draft-1/selection',
      { previewVersion: 'version-1', selectedMobiles: ['+97333991122'] },
    )
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    await screen.findByText(/0 unique mobiles selected/)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Send via WhatsApp',
      }).disabled,
    ).toBe(true)
  })
  it('prompts for the updated invoice after an edit and skipping makes no send request', async () => {
    const { onClose } = mount('invoice_updated')
    await screen.findByRole('heading', {
      name: 'Invoice saved. Send the updated invoice?',
    })
    await screen.findByTitle('Invoice PDF preview')
    expect(apiClient.post).toHaveBeenCalledWith(
      '/invoices/invoice-1/notifications',
      expect.objectContaining({ kind: 'invoice_updated' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalled()
    expect(
      vi
        .mocked(apiClient.post)
        .mock.calls.some(([path]) => String(path).endsWith('/send')),
    ).toBe(false)
  })
  it('keeps sending disabled until the actual attachment is available', async () => {
    vi.mocked(apiClient.get).mockImplementation(() => new Promise(() => {}))
    mount()
    await screen.findByText(/2 unique mobiles selected/)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Send via WhatsApp',
      }).disabled,
    ).toBe(true)
    expect(screen.queryByTitle('Invoice PDF preview')).toBeNull()
  })
  it('blocks a stale preview after the server detects changes', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (path) => {
      if (String(path).endsWith('/send'))
        throw Object.assign(
          new Error('The invoice changed. Refresh before sending.'),
          { status: 409 },
        )
      return { data: draft }
    })
    mount()
    await screen.findByTitle('Invoice PDF preview')
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    await screen.findByText(
      'This preview is out of date. Refresh before sending.',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Send via WhatsApp',
      }).disabled,
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeTruthy()
  })
})
