import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PermissionGuard } from '@/components/permission-guard'
import { StaffName } from '@/features/users/components/staff-name'
import { CURRENCY } from '@/lib/currency'
import { useGiftCardByCode } from './hooks/use-gift-card-by-code'
import { canReplaceGiftCard, giftCardStatus } from './lib/gift-card-status'
import { ReplaceGiftCardDialog } from './components/replace-gift-card-dialog'

/** Open a card's current balance, expiry, issuer, and navigable replacement history. */
export function GiftCardDetailPage({ code }: { code: string }) {
  const { data: card, isLoading, isError } = useGiftCardByCode(code)
  const [replacing, setReplacing] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading gift card…</p>
  if (isError || !card)
    return (
      <div className="space-y-3">
        <p role="alert">
          {isError ? 'Could not load this gift card.' : 'Gift card not found.'}
        </p>
        <Link to="/gift-cards" className="text-sm underline">
          Back to Gift Cards
        </Link>
      </div>
    )
  return (
    <div className="max-w-3xl space-y-6">
      <Link
        to="/gift-cards"
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        Back to Gift Cards
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold">{card.code}</h1>
          <Badge variant="outline" className="mt-2">
            {giftCardStatus(card, today)}
          </Badge>
        </div>
        <PermissionGuard method="POST" path="/gift-cards/:id/replace">
          <Button
            disabled={!canReplaceGiftCard(card, today)}
            onClick={() => setReplacing(true)}
          >
            Replace card
          </Button>
        </PermissionGuard>
      </div>
      <dl className="space-y-4 rounded-xl border border-border/60 bg-card p-5 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Balance</dt>
          <dd className="font-semibold">
            {CURRENCY} {card.balance.toFixed(2)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Initial value</dt>
          <dd>
            {CURRENCY} {card.initialAmount.toFixed(2)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{card.expiresOn ?? 'Never'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Issued by</dt>
          <dd>
            <StaffName userId={card.issuedBy} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Bought by</dt>
          <dd>{card.customerName ?? 'Not recorded'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Recipient</dt>
          <dd>
            {card.boughtFor ?? 'Not named'}
            {card.recipientPhone && ` · ${card.recipientPhone}`}
          </dd>
        </div>
        {card.replacesCardCode && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Replaces</dt>
            <dd>
              <Link
                to="/gift-cards/$code"
                params={{ code: card.replacesCardCode }}
                className="font-mono underline underline-offset-4"
              >
                {card.replacesCardCode}
              </Link>
            </dd>
          </div>
        )}
        {card.replacedByCardCode && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Replaced by</dt>
            <dd>
              <Link
                to="/gift-cards/$code"
                params={{ code: card.replacedByCardCode }}
                className="font-mono underline underline-offset-4"
              >
                {card.replacedByCardCode}
              </Link>
            </dd>
          </div>
        )}
      </dl>
      {replacing && (
        <ReplaceGiftCardDialog
          key={card.id}
          card={card}
          onClose={() => setReplacing(false)}
        />
      )}
    </div>
  )
}
