import { CURRENCY } from '@/lib/currency'
import { extractNet, extractVat } from '../../lib/invoice-pricing'

// Prices are entered gross (VAT included). The hint splits what was typed
// into net and VAT so staff quote knowing both — it is display-only, the
// invoice totals do the same split once per invoice.
export function GrossVatHint({ gross }: { gross: number | '' }) {
  if (typeof gross !== 'number' || gross <= 0) return null

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Incl. VAT — net {CURRENCY} {extractNet(gross).toFixed(2)} + VAT{' '}
      {extractVat(gross).toFixed(2)}
    </p>
  )
}
