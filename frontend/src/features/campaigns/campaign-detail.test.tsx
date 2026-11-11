import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { CampaignDetailPage } from './campaign-detail'
import type { Campaign, MarketingTemplate } from './types'
import type * as ApiModule from '@/lib/api'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}))

const template: MarketingTemplate = {
  id: 'template-1',
  revision: 't-revision',
  name: 'offer_v1',
  language: 'en_US',
  state: 'approved',
  providerId: 'meta-id',
  rejectionReason: null,
  archived: false,
  syncedAt: null,
  definition: {
    body: 'Save {{1}} this week.\nخصم هذا الأسبوع',
    examples: ['20%'],
    footer: 'Offer ends Friday',
    imageHeader: false,
    sampleAssetId: null,
    websiteUrl: 'https://thobx.bh',
    websiteLabel: 'Shop now',
    unsubscribeLabel: 'Unsubscribe',
  },
}
function fixture(): Campaign {
  const audience = { neverPurchased: false, excludedCustomerIds: [] }
  return {
    id: 'campaign-1',
    revision: 'revision-1',
    name: 'Season sale',
    state: 'draft',
    previewVersion: 'preview-1',
    approvedBy: null,
    approvedAt: null,
    sendAt: null,
    expiresAt: null,
    blockedReason: null,
    createdAt: '2026-11-01T00:00:00Z',
    definition: {
      name: 'Season sale',
      templateId: template.id,
      parameters: ['20%'],
      assetId: null,
      audience,
      sendAt: '2026-12-01T09:00:00Z',
      expiresAt: '2026-12-02T09:00:00Z',
    },
    preview: {
      version: 'preview-1',
      revision: 'revision-1',
      template,
      body: 'Save 20% this week.\nخصم هذا الأسبوع',
      parameters: ['20%'],
      assetId: null,
      sendAt: '2026-12-01T09:00:00Z',
      expiresAt: '2026-12-02T09:00:00Z',
      destinations: [
        {
          mobile: '+97333112233',
          excludedReason: null,
          customers: [
            {
              id: 'customer-1',
              name: 'Ahmed',
              mobileNo: '33112233',
              purchaseCount: 2,
              lifetimeSpend: '200.00',
              lastPurchase: null,
            },
            {
              id: 'customer-2',
              name: 'Ali',
              mobileNo: '+97333112233',
              purchaseCount: 1,
              lifetimeSpend: '100.00',
              lastPurchase: null,
            },
          ],
        },
      ],
      excluded: [
        {
          mobile: '+97333991122',
          customers: [
            {
              id: 'customer-3',
              name: 'Fatima',
              mobileNo: '33991122',
              purchaseCount: 0,
              lifetimeSpend: '0',
              lastPurchase: null,
            },
          ],
          excludedReason: 'No current WhatsApp marketing consent.',
        },
      ],
    },
  }
}
let campaign: Campaign
function mount(canSend = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['campaigns', campaign.id], campaign)
  client.setQueryData(['campaign-capabilities'], {
    canSend,
    canManageTemplates: true,
    timezone: 'Asia/Bahrain',
  })
  client.setQueryData(['campaign-recipients', campaign.id, 1], {
    items: [],
    total: 0,
    counts: {},
    unsubscribes: 0,
  })
  render(
    <QueryClientProvider client={client}>
      <CampaignDetailPage id={campaign.id} />
    </QueryClientProvider>,
  )
  return client
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAuth).mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    error: null,
    user: {
      id: 'manager',
      name: 'Manager',
      email: 'manager@example.com',
      roles: ['manager'],
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
  })
  campaign = fixture()
  vi.mocked(apiClient.get).mockImplementation(async (path) => ({
    data: String(path).includes('/recipients')
      ? { items: [], total: 0, counts: {}, unsubscribes: 0 }
      : campaign,
  }))
  vi.mocked(apiClient.post).mockImplementation(async (path) => {
    if (String(path).endsWith('/approve'))
      campaign = { ...campaign, state: 'scheduled' }
    return { data: campaign }
  })
})
describe('campaign review and manager approval', () => {
  it('shows exact bilingual message, buttons, grouped recipients and business schedule without sending', () => {
    mount()
    expect(screen.getByText(/Save 20% this week/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Shop now' }).getAttribute('href'),
    ).toBe('https://thobx.bh')
    expect(screen.getByText('Unsubscribe')).toBeTruthy()
    expect(screen.getByText('Ahmed, Ali')).toBeTruthy()
    expect(screen.getByText(/2026-12-01 12:00/)).toBeTruthy()
    expect(apiClient.post).not.toHaveBeenCalled()
  })
  it('approves only after an explicit manager click and includes the reviewed versions', async () => {
    mount()
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve and schedule' }),
    )
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/campaigns/campaign-1/approve',
        {
          expectedRevision: 'revision-1',
          previewVersion: 'preview-1',
          requestId: expect.any(String),
        },
      ),
    )
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })
  it('sales can review and prepare but cannot approve or cancel', () => {
    vi.mocked(useAuth).mockReturnValue({
      ...useAuth(),
      user: {
        id: 'sales',
        name: 'Sales',
        email: 'sales@example.com',
        roles: ['sales'],
      },
    })
    mount()
    expect(
      screen.queryByRole('button', { name: 'Approve and schedule' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel campaign' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Prepare fresh preview' }),
    ).toBeTruthy()
  })
  it('disables approval when delivery is off and retains the saved draft after preview failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new ApiError('Template paused', 409),
    )
    mount(false)
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Approve and schedule',
      }).disabled,
    ).toBe(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare fresh preview' }),
    )
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/campaigns/campaign-1/preview',
        undefined,
      ),
    )
    expect(screen.getByRole('heading', { name: 'Season sale' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit draft' })).toBeTruthy()
  })
  it('excludes every associated customer at a shared destination and requires a new preview', async () => {
    vi.mocked(apiClient.patch).mockImplementation(async (_, body) => ({
      data: {
        ...campaign,
        definition: body,
        revision: 'revision-2',
        preview: null,
      },
    }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/campaigns/campaign-1',
        expect.objectContaining({
          expectedRevision: 'revision-1',
          audience: expect.objectContaining({
            excludedCustomerIds: ['customer-1', 'customer-2'],
          }),
        }),
      ),
    )
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})
