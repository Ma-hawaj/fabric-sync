# WhatsApp promotional campaigns

Campaigns are independent of invoice and gift-card notifications. Sales staff
prepare drafts, templates and consent records. Managers/admins submit templates,
approve sending or scheduling, cancel pending deliveries and archive templates.

## Setup

Apply the normal migrations, including `0005_marketing_campaigns.sql`. It is an
additive migration for existing databases. It grants no marketing consent.

Configure the existing WhatsApp Cloud API sender and signed webhook, then add:

```dotenv
WHATSAPP_MARKETING_ENABLED=false
WHATSAPP_WABA_ID=
WHATSAPP_META_APP_ID=
WHATSAPP_CAMPAIGN_INTERVAL_MS=1000
```

The access token needs `whatsapp_business_management` for template submission,
status reads and synchronization, and `whatsapp_business_messaging` for delivery.
The WABA and app IDs must belong to the configured sender. The app ID is needed
for Meta resumable uploads of template sample images. Use the existing
`WHATSAPP_API_VERSION` and `TIMEZONE` settings. Subscribe the existing webhook to
`messages` and `message_template_status_update`; retain HMAC signature checking.

Both `WHATSAPP_DELIVERY_ENABLED` and `WHATSAPP_MARKETING_ENABLED` must be true to
approve or dispatch a campaign. Missing credentials leave drafts usable. Meta
connections also need outbound access to `graph.facebook.com` in the deployed
runtime. The minimum dispatch interval is shared by all application replicas;
it defaults to one second and is configurable from 100 to 60000 milliseconds.
The campaign worker is separate from the invoice worker and uses PostgreSQL;
there is no additional queue service.

## Consent

On an existing customer's edit page, use **WhatsApp marketing consent** to record
an explicit opt-in or withdrawal, when it was obtained and how. This action saves
separately from customer details and applies to the displayed saved mobile.
Consent is shared by all customers using that normalized number. New numbers do
not inherit consent from old numbers. Invoice-update preferences are independent.

Signed inbound unsubscribe button replies, or exact trimmed replies `STOP`,
`UNSUBSCRIBE`, `إلغاء`, or `الغاء`, withdraw marketing consent. Other conversational
text is ignored. Events are deduplicated by provider message ID. Older events do
not override newer consent; an unsubscribe wins a same-second timestamp tie.
Re-subscription requires a new explicit staff-recorded consent event. Raw webhook
retention follows the existing WhatsApp retention setting; consent audit events
and approved campaign history are retained.

## Templates and approval

Create a template using lowercase letters, digits and underscores. Use contiguous
numbered body fields (`{{1}}`, `{{2}}`, etc.) and provide one sample value per
field for Meta. A template has one language code; its body can be bilingual.
Supported formats are text or image headers, an optional static footer, one
optional static HTTPS website button, and a required unsubscribe quick reply.
Images are private PNG/JPEG assets up to 5 MB. Staff upload a sample image when
submitting an image template and choose the actual campaign image when composing.

Managers submit templates as `MARKETING`. Only supported approved templates can
be used. Synchronization imports supported marketing templates and refreshes
provider status; a background refresh runs every five minutes. Submitted
versions cannot be edited locally. Create a new version with a new provider name
after rejection or to change wording. Interrupted submissions remain reserved;
synchronize before attempting a new version. Archiving is local and prevents
further use without deleting the template from Meta.

## Campaigns

1. Choose an approved template, fill offer details once and attach an image if
   required. Every destination receives the same content.
2. Optionally combine last-purchase dates, never-purchased status, purchase-count
   bounds, lifetime-value bounds and issuing branch. Empty filters include all
   eligible customers. Dates use `TIMEZONE`.
3. Set a sending start or leave it empty for immediate sending on approval. A
   future final sending deadline is mandatory.
4. Save and prepare a preview. Search the audience and exclude individual
   customers; excluding one customer excludes their shared mobile destination.
   Prepare a fresh preview after changing exclusions.
5. A manager reviews the exact message, image, footer, buttons, unique
   destinations and schedule, then approves. Approval freezes that snapshot.

The audience section shows a live message count as filters change. It counts
unique mobile destinations after consent checks and exclusions; it also shows
matching and excluded customer counts. This estimate is available before saving
a draft or choosing a template, and approval confirms the final audience.

Purchase metrics count distinct associated invoices, including tailoring and
retail purchases. Net invoice totals after credits determine value; fully
credited invoices are excluded. A shared invoice counts once for each associated
customer. The branch filter requires an associated purchase issued at that branch;
it does not narrow the lifetime totals. Missing legacy issuing branches do not
match a branch filter.

Approval uses a revision, preview version and idempotency key. Changed audience,
consent, template or image requires a new review. Approved campaigns are
immutable. Cancel their unstarted deliveries before copying to a replacement
campaign. Copying is an intentional new campaign and does not deduplicate
against earlier campaigns; review prior delivery outcomes first.

## Delivery and operations

Scheduled times indicate when sending starts, not a simultaneous broadcast.
Frozen audiences never acquire new customers after approval. Consent withdrawal,
changed source phone numbers, template ineligibility, cancellation and deadlines
are checked before submission. A Meta outage or paused template blocks delivery;
the same approved template may resume before the deadline. Changed template
content requires a new campaign approval. The worker resumes durable jobs after
restart and expires unsent messages at the deadline.

Known transient errors use bounded backoff and `Retry-After`. An interrupted
message submission or expired lease after submission is **uncertain** and is
never replayed automatically. Reconcile provider delivery before any intentional
new campaign. Image-upload retries alone do not send messages.

The delivery page reports recipient outcomes and unsubscribe counts. Accepted
means Meta accepted the message; delivered/read depend on provider receipts and
may arrive later. Late or duplicate webhooks cannot downgrade delivery state.
Cancellation and opt-out cannot recall messages already submitted to Meta.

Back up campaign/consent/asset tables with PostgreSQL. Monitor blocked campaigns,
uncertain outcomes, queue age relative to deadlines, and provider errors.
Disabling marketing pauses dispatch while retaining approvals and history;
deadlines still expire. Routine logs should contain IDs and error codes, never
access tokens, image bytes or full message bodies.

## Verification before enabling production

Run the repository backend/frontend checks and database integration tests against
PostgreSQL 18+. Provider tests use local HTTP mocks and isolated databases.
Use only designated WhatsApp test recipients for staging: submit a supported
template, wait for actual Meta approval, confirm exact image/text/buttons,
schedule a campaign, withdraw consent, verify a deadline and inspect delivered
receipts. Enable marketing delivery only after those checks; implementation
and automated tests do not establish Meta account readiness.
