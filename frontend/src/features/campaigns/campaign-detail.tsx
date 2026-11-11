import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PermissionGuard } from '@/components/permission-guard'
import { Input } from '@/components/ui/input'
import {
  useCampaign,
  useCampaignCapabilities,
  useCampaignMutation,
  useCampaignRecipients,
} from './hooks'
import { AssetImage, StateBadge, errorMessage } from './components'
import { CampaignFormPage } from './campaign-form'
import { businessTime } from './lib/business-time'
import type { Campaign, CampaignPreview } from './types'

export function CampaignDetailPage({ id }: { id: string }) {
  const query = useCampaign(id)
  const [editing, setEditing] = useState(false)
  if (query.isError)
    return (
      <p role="alert">
        Could not load this campaign.{' '}
        <button onClick={() => void query.refetch()}>Try again</button>
      </p>
    )
  if (!query.data) return <p>Loading campaign...</p>
  const c = query.data
  if (editing && c.state === 'draft')
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => setEditing(false)}>
          Back to review
        </Button>
        <CampaignFormPage existing={c} onSaved={() => setEditing(false)} />
      </div>
    )
  return (
    <CampaignDetail
      key={c.revision}
      campaign={c}
      onEdit={() => setEditing(true)}
    />
  )
}
function CampaignDetail({
  campaign: c,
  onEdit,
}: {
  campaign: Campaign
  onEdit: () => void
}) {
  const mutation = useCampaignMutation()
  const prepare = useCampaignMutation<CampaignPreview>()
  const capabilities = useCampaignCapabilities()
  const navigate = useNavigate()
  const [requestId] = useState(() => crypto.randomUUID())
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(50)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [page, setPage] = useState(1)
  const active = ['scheduled', 'sending', 'blocked'].includes(c.state)
  const delivery = useCampaignRecipients(c.id, page, active)
  const preview = c.preview
  const busy = mutation.isPending || prepare.isPending
  function preparePreview() {
    const pending = prepare.mutateAsync({ path: `/campaigns/${c.id}/preview` })
    void pending.catch(() => undefined)
    toast.promise(pending, {
      loading: 'Preparing the message and audience...',
      success: 'Preview ready for review.',
      error: errorMessage,
    })
  }
  async function exclude(ids: string[]) {
    const pending = mutation.mutateAsync({
      path: `/campaigns/${c.id}`,
      method: 'patch',
      body: {
        ...c.definition,
        expectedRevision: c.revision,
        audience: {
          ...c.definition.audience,
          excludedCustomerIds: [
            ...new Set([...c.definition.audience.excludedCustomerIds, ...ids]),
          ],
        },
      },
    })
    void pending.catch(() => undefined)
    toast.promise(pending, {
      loading: 'Updating audience...',
      success: 'Audience updated. Prepare a new preview.',
      error: errorMessage,
    })
    try {
      await pending
    } catch {
      return
    }
  }
  const timezone = capabilities.data?.timezone
  const displayTime = (value: string | null) =>
    value
      ? timezone
        ? `${businessTime(value, timezone).replace('T', ' ')} (${timezone})`
        : new Date(value).toLocaleString()
      : 'Immediately after approval'
  const destinations =
    preview?.destinations.filter((d) =>
      `${d.mobile} ${d.customers.map((customer) => customer.name).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? []
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm text-info hover:underline" to="/campaigns">
            Campaigns
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{c.name}</h1>
          <div className="mt-2">
            <StateBadge state={c.state} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.state === 'draft' && (
            <>
              <Button variant="outline" onClick={onEdit}>
                Edit draft
              </Button>
              <Button onClick={preparePreview} disabled={busy}>
                Prepare fresh preview
              </Button>
            </>
          )}
          {c.state !== 'draft' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                const future = Date.now() + 24 * 3600000
                const pending = mutation.mutateAsync({
                  path: '/campaigns',
                  body: {
                    ...c.definition,
                    name: `${c.name} copy`,
                    expectedRevision: undefined,
                    sendAt: null,
                    expiresAt: new Date(
                      Math.max(future, Date.parse(c.definition.expiresAt)),
                    ).toISOString(),
                  },
                })
                void pending.catch(() => undefined)
                toast.promise(pending, {
                  loading: 'Creating draft...',
                  success:
                    'New draft created. Review its audience before approval.',
                  error: errorMessage,
                })
                let created: Campaign
                try {
                  created = await pending
                } catch {
                  return
                }
                await navigate({
                  to: '/campaigns/$campaignId',
                  params: { campaignId: created.id },
                })
              }}
            >
              Copy to new draft
            </Button>
          )}
        </div>
      </div>
      {c.blockedReason && (
        <p role="alert" className="rounded-lg border border-destructive/40 p-4">
          {c.blockedReason}
        </p>
      )}
      {capabilities.data && !capabilities.data.canSend && (
        <p className="rounded-lg border p-4 text-sm">
          WhatsApp marketing delivery is disabled or not configured. Drafts and
          previews are available.
        </p>
      )}
      {preview && (
        <>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <h2 className="text-lg font-medium">Message preview</h2>
            <p className="text-sm text-muted-foreground">
              {preview.template.name} · {preview.template.language}
            </p>
            {preview.assetId && <AssetImage id={preview.assetId} />}
            <p
              className="whitespace-pre-wrap rounded-lg bg-muted p-4"
              dir="auto"
            >
              {preview.body}
            </p>
            {preview.template.definition.footer && (
              <p className="text-sm text-muted-foreground" dir="auto">
                {preview.template.definition.footer}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {preview.template.definition.websiteUrl && (
                <a
                  href={preview.template.definition.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  {preview.template.definition.websiteLabel}
                </a>
              )}
              <span className="rounded-md border px-3 py-2 text-sm">
                {preview.template.definition.unsubscribeLabel}
              </span>
            </div>
            <p className="text-sm">
              Sending starts: {displayTime(preview.sendAt)}
              <br />
              Sending deadline: {displayTime(preview.expiresAt)}
            </p>
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <h2 className="text-lg font-medium">
              Reviewed audience · {preview.destinations.length} unique numbers
            </h2>
            <p className="text-sm text-muted-foreground">
              Approval freezes this audience. Consent withdrawals and changed
              phone numbers are checked again before sending.
            </p>
            <Input
              aria-label="Search reviewed audience"
              placeholder="Search name or mobile"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setVisible(50)
              }}
            />
            <ul className="divide-y">
              {destinations.slice(0, visible).map((d) => (
                <li
                  key={d.mobile}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div>
                    <span className="font-medium">
                      {d.customers.map((customer) => customer.name).join(', ')}
                    </span>
                    <p className="text-sm text-muted-foreground">{d.mobile}</p>
                  </div>
                  {c.state === 'draft' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void exclude(d.customers.map((customer) => customer.id))
                      }
                    >
                      Exclude
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {destinations.length > visible && (
              <Button
                variant="outline"
                onClick={() => setVisible(visible + 50)}
              >
                Show more recipients
              </Button>
            )}
            {preview.excluded.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm">
                  {preview.excluded.length} excluded destinations
                </summary>
                <ul className="mt-3 space-y-2 text-sm">
                  {preview.excluded.map((d, index) => (
                    <li key={index}>
                      {d.customers.map((customer) => customer.name).join(', ')}{' '}
                      · {d.mobile || 'No mobile'}: {d.excludedReason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          {c.state === 'draft' && (
            <PermissionGuard method="POST" path="/campaigns/:id/approve">
              <div className="space-y-3 rounded-xl border p-5">
                <p className="text-sm">
                  Approve the message above for {preview.destinations.length}{' '}
                  unique numbers.{' '}
                  {preview.sendAt
                    ? 'It will start at the scheduled time.'
                    : 'It will begin sending immediately.'}
                </p>
                <Button
                  disabled={
                    busy ||
                    !capabilities.data?.canSend ||
                    !preview.destinations.length
                  }
                  onClick={() => {
                    const pending = mutation.mutateAsync({
                      path: `/campaigns/${c.id}/approve`,
                      body: {
                        expectedRevision: c.revision,
                        previewVersion: preview.version,
                        requestId,
                      },
                    })
                    void pending.catch(() => undefined)
                    toast.promise(pending, {
                      loading: 'Approving campaign...',
                      success: 'Campaign approved and queued.',
                      error: errorMessage,
                    })
                  }}
                >
                  {preview.sendAt
                    ? 'Approve and schedule'
                    : 'Approve and send now'}
                </Button>
              </div>
            </PermissionGuard>
          )}
        </>
      )}
      {c.state !== 'draft' && (
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="text-lg font-medium">Delivery progress</h2>
          {delivery.isError && (
            <p role="alert">Could not load delivery progress.</p>
          )}
          <div className="flex flex-wrap gap-3">
            {Object.entries(delivery.data?.counts ?? {}).map(
              ([state, count]) => (
                <div key={state} className="rounded-lg bg-muted px-4 py-3">
                  <p className="text-xl tabular-nums">{count}</p>
                  <p className="text-xs capitalize">{state}</p>
                </div>
              ),
            )}
            <div className="rounded-lg bg-muted px-4 py-3">
              <p className="text-xl">{delivery.data?.unsubscribes ?? 0}</p>
              <p className="text-xs">Unsubscribes</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Accepted means Meta accepted the message. Delivery and read receipts
            may arrive later. Uncertain submissions require reconciliation
            before any intentional resend.
          </p>
          <ul className="divide-y">
            {delivery.data?.items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap justify-between gap-2 py-3"
              >
                <div>
                  <p>
                    {r.customers.map((customer) => customer.name).join(', ')} ·{' '}
                    {r.mobile}
                  </p>
                  {r.error_message && (
                    <p className="text-sm text-muted-foreground">
                      {r.error_message}
                    </p>
                  )}
                </div>
                <StateBadge state={r.state} />
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm">
              Page {page} of{' '}
              {Math.max(1, Math.ceil((delivery.data?.total ?? 0) / 50))}
            </span>
            <Button
              variant="outline"
              disabled={page * 50 >= (delivery.data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </section>
      )}
      {!['completed', 'cancelled', 'expired'].includes(c.state) && (
        <PermissionGuard method="POST" path="/campaigns/:id/cancel">
          <div className="space-y-3 rounded-xl border p-5">
            {confirmCancel ? (
              <>
                <p>
                  Cancel this campaign and all deliveries that have not started?
                  Messages already submitting or accepted may still arrive.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      const pending = mutation.mutateAsync({
                        path: `/campaigns/${c.id}/cancel`,
                      })
                      void pending.catch(() => undefined)
                      toast.promise(pending, {
                        loading: 'Cancelling campaign...',
                        success: 'Unstarted deliveries cancelled.',
                        error: errorMessage,
                      })
                      setConfirmCancel(false)
                    }}
                  >
                    Confirm cancellation
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmCancel(false)}
                  >
                    Keep campaign
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirmCancel(true)}>
                Cancel campaign
              </Button>
            )}
          </div>
        </PermissionGuard>
      )}
    </div>
  )
}
