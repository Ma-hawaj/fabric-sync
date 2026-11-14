import type { CostEstimate } from './types'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})
const money = (amount: string) => usd.format(Number(amount))

export function CampaignCostEstimate({
  estimate,
}: {
  estimate: CostEstimate | null | undefined
}) {
  if (!estimate) {
    return (
      <p className="text-sm text-muted-foreground">
        No cost estimate was saved with this preview.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Estimated Meta cost</p>
      <p className="text-2xl font-semibold tabular-nums">
        {estimate.total === null ? 'Total unavailable' : money(estimate.total)}
      </p>
      {estimate.unpricedMessageCount > 0 && (
        <p className="text-sm">
          {estimate.unpricedMessageCount.toLocaleString()}{' '}
          {estimate.unpricedMessageCount === 1
            ? 'destination has'
            : 'destinations have'}{' '}
          no verified rate. Priced subtotal: {money(estimate.pricedSubtotal)}.
          This is not the full campaign cost.
        </p>
      )}
      {estimate.breakdown.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">Rates by destination</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Market
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Messages
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    USD / message
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Subtotal (USD)
                  </th>
                </tr>
              </thead>
              <tbody>
                {estimate.breakdown.map((line) => (
                  <tr key={line.market} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      {line.market}
                    </th>
                    <td className="py-2 pr-4 text-right">
                      {line.messageCount.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right">{line.unitPrice}</td>
                    <td className="py-2 text-right">{line.subtotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-xs text-muted-foreground">
        Assumes every eligible message is delivered. Meta charges on delivery.
        Excludes provider fees and taxes; free messaging windows are not
        deducted. Rates may change before delivery, including scheduled
        campaigns.
      </p>
      <p className="text-xs text-muted-foreground">
        USD marketing rates effective {estimate.rateCardEffectiveFrom}; checked{' '}
        {estimate.rateCardVerifiedOn}.{' '}
        <a
          href={estimate.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Meta pricing
        </a>
      </p>
    </div>
  )
}
