import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignCostEstimate } from './cost-estimate'
import type { CostEstimate } from './types'

const estimate: CostEstimate = {
  currency: 'USD',
  total: '39.2000',
  pricedSubtotal: '39.2000',
  unpricedMessageCount: 0,
  rateCardEffectiveFrom: '2026-10-01',
  rateCardVerifiedOn: '2026-11-14',
  sourceUrl:
    'https://developers.facebook.com/docs/whatsapp/pricing/#rate-cards',
  breakdown: [
    {
      market: 'Rest of Middle East',
      messageCount: 1000,
      unitPrice: '0.0392',
      subtotal: '39.2000',
    },
  ],
}

it('shows USD total, sub-cent unit price, rate date and delivery assumptions', () => {
  render(<CampaignCostEstimate estimate={estimate} />)
  expect(screen.getByText(/USD\s+39\.20/)).toBeTruthy()
  expect(screen.getByText('0.0392')).toBeTruthy()
  expect(screen.getByText('1,000')).toBeTruthy()
  expect(
    screen.getByText(/effective 2026-10-01; checked 2026-11-14/),
  ).toBeTruthy()
  expect(screen.getByText(/Meta charges on delivery/)).toBeTruthy()
  expect(screen.getByText(/Rates may change before delivery/)).toBeTruthy()
  expect(
    screen.getByRole('link', { name: 'Meta pricing' }).getAttribute('href'),
  ).toBe(estimate.sourceUrl)
})

it('does not label a partial subtotal as the campaign total', () => {
  render(
    <CampaignCostEstimate
      estimate={{ ...estimate, total: null, unpricedMessageCount: 2 }}
    />,
  )
  expect(screen.getByText('Total unavailable')).toBeTruthy()
  expect(screen.getByText(/2 destinations have no verified rate/)).toBeTruthy()
  expect(screen.getByText(/Priced subtotal: USD\s+39\.20/)).toBeTruthy()
})

it('does not invent a zero for historical snapshots without an estimate', () => {
  render(<CampaignCostEstimate estimate={undefined} />)
  expect(
    screen.getByText('No cost estimate was saved with this preview.'),
  ).toBeTruthy()
  expect(screen.queryByText(/USD/)).toBeNull()
})
