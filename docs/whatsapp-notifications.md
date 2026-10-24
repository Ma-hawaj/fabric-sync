# Invoice PDFs and WhatsApp notifications

Invoices and order readiness are saved independently of notifications. Creation
opens a preview, successful edits offer an updated-invoice resend preview, and
invoice detail/list actions offer **Resend invoice via WhatsApp**. Marking the
last uncollected order ready offers the pickup preview. Closing or skipping a
preview does not undo the saved invoice or readiness.

## Production and pickup locations

The production branch is the physical location where a garment is made. It is
selected per order as **Made at** / **Production Location**. The invoice's pickup
branch is where the customer collects the finished garment. A single location
can serve both purposes.

Readiness requires an explicitly assigned production location and a pickup
branch so it can determine whether the garment must move between locations.
If they differ, the delivery stage must record delivery to the pickup branch.
If they match, no transfer is needed. Production stages and repairs must also
be complete, and staff must confirm the garment is physically at the pickup
branch. An inferred stock location is a suggestion until assigned to the order.

Collection is a separate action from readiness: it records that the customer
has taken the garment. The database and API use `collected`, `collectedAt`,
`lastCollectedAt`, and `/collect` consistently.

## Database setup

The migrations are an ordered fresh-database baseline; see
[the migration guide](../backend/migrations/README.md). Notification fields are
declared directly in the core tables, with notification storage, readiness and
revision triggers, and list indexes in separate migrations.

All invoice customers are selected by default. The server parses numbers using
`WHATSAPP_DEFAULT_REGION` and groups them by E.164 mobile, so local and
international representations of a shared number receive one notification.
The preview lists the customers sharing each destination. Invalid numbers and
disabled WhatsApp update preferences appear as exclusions; a disabled customer
sharing a mobile blocks that destination. Preferences can be changed on the
customer form and saved with the name and mobile number using **Save**.
Changing the checkbox or cancelling the form does not persist the preference.
The preference defaults to enabled for new customers and is independent of
marketing messages.

## PDF rendering

Run `docker compose up -d document-renderer` and set
`DOCUMENT_RENDERER_URL=http://localhost:53000` in the backend's environment for
local development. The production compose file supplies the internal URL.

The pinned Gotenberg 8.38.0 image includes Noto Sans Arabic. Its browser cannot
fetch remote HTTP assets; invoice HTML, designs, logo, and QR are self-contained.
Its deny list also retains Gotenberg's default restriction on file URLs outside
`/tmp/`, alongside the HTTP(S) restriction.
The backend allows two simultaneous conversions, a 45-second HTTP timeout, and
a 20 MB PDF limit. It stores generated PDFs privately in Postgres with an input
fingerprint, byte count, and SHA-256. Preview/download/upload use those stored
bytes. Approval never regenerates an attachment.

Design labels and images are resolved from the current design catalog when the
HTML is prepared. A catalog change invalidates an older preview; the original
stored PDF remains available in its notification history.

Keep `DOCUMENT_RENDERER_PROFILE` aligned with the pinned image and fonts. Change
it when their rendering behavior changes so cached PDFs are not silently reused
under a different renderer. Back up document artifacts with the database.

## Sender setup

Configure a Meta WhatsApp Business sender using the variables in
`backend/.env.example`. For local `cargo run`, copy that file to `backend/.env`.
The root `.env.example` contains compose infrastructure settings only, including
the renderer's published port. For production compose, supply the backend runtime
variables through the deployment environment; the compose file passes them into
the app container. Printed-document timezone configuration stays in
`backend/.env.example`; standalone runs read it from `backend/.env`.
Set `WHATSAPP_DELIVERY_ENABLED=true` only when the sender and approved templates
are available. Unconfigured delivery never reports simulated success. PDF
previews and invoice work are available independently of delivery configuration.

Register these utility templates in the configured language. The default is
`en_US`; the invoice PDF itself is bilingual. To use another approved language
or wording, set the template name, language, and exact body together. The body
shown in the preview must match the approved template, including punctuation,
footer, and buttons. The initial templates have no footer or buttons.

| Template | Header | Exact default body | Parameters |
| --- | --- | --- | --- |
| `invoice_document_v1` | Document/PDF | `Your invoice {{1}} from {{2}} is attached. Total: {{3}}. Balance due: {{4}}.` | Invoice reference, company name, total with BHD, balance with BHD |
| `invoice_ready_v1` | None | `Your order for invoice {{1}} is ready for pickup at {{2}}. Balance due: {{3}}.` | Invoice reference, pickup branch, balance with BHD |
| `gift_card_image_v1` | Image/PNG | `Hello {{1}}, you have a gift card from {{2}}. Code: {{3}}. Available balance: {{4}}. Expires: {{5}}.` | Recipient name (or `there`), company name, card code, available balance with BHD, expiry date (or `Never`) |

Gift card codes are generated by the server when issued directly or sold on an
invoice. Codes use 12 random characters in three groups, for example
`GC-7KMP-4RWT-9DXH`, omitting `0`, `O`, `1`, and `I` to reduce typing mistakes.
At checkout, staff can enter the 12 characters without the `GC` prefix, spaces,
or dashes; matching is case-insensitive. The form fills in the stored code once
it finds the card. All entries are normalized to this format before lookup,
redemption, and duplicate-card validation. A database uniqueness constraint and
automatic retries handle generated-code collisions.

Each card requires a recipient phone number; **Bought for** is
optional and separate from the buyer. Staff can correct these details through
**Edit recipient** on the Gift Cards page. Codes and balances
cannot be changed there.

Choose **Send via WhatsApp** on a gift card to preview the destination and exact
message, then approve Send. A branded 1200×720 PNG shows the recipient, available
balance, expiry, redeemable code, and a QR code containing the same code. The
preview includes the exact image to approve and a PNG download link. **Download
image** on the Gift Cards list also works independently of WhatsApp setup and
does not require a saved recipient number. Voided, expired, and fully redeemed
cards are labelled accordingly.

The server renders PNGs locally from the bundled SVG and licensed DejaVu fonts,
including Arabic text shaping, without requiring the PDF renderer or an external
image service. Company name and optional PNG/JPEG/WebP logo come from the same
`COMPANY_*` branding settings used for invoices.

The PNG is attached as the WhatsApp template's image header; the code also stays
in the message body for copying. It does not attach the buyer's invoice. The
approved template must have an **IMAGE** header; a text-only gift card template
cannot receive the image. Set `WHATSAPP_GIFT_CARD_TEMPLATE` and
`WHATSAPP_GIFT_CARD_BODY` to the approved gift card template and exact wording.
Delivery uses the existing sender configuration and signed status webhook.
Approval stores the exact PNG bytes, filename, and SHA-256 in the original
notification schema. The preview version includes the image hash, and retries
upload the same approved bytes. A failed image upload never submits a message.
The gift card list refreshes delivery status every ten seconds while open.
Accepted means the provider accepted the message; delivered/read require a
provider callback. Errors remain visible beside the status.

Approval queues a durable send; retries of the same approval request are
idempotent. Known transient errors retry with bounded backoff. Interrupted or
unknown submissions become uncertain and require checking delivery before an
explicit resend. Recipient, balance, expiry, or active-status changes cancel
unstarted sends. Once a gift card has any approved delivery history, the invoice
that sold it cannot be rebuilt, preserving the distributed code and delivery
audit. Recipient details can still be corrected from Gift Cards.

The generic invoice document wording is used for creation, edits, and explicit
resends. Set `WHATSAPP_INVOICE_BODY` / `WHATSAPP_READY_BODY` to the exact approved
wording if it differs. Approved template messages are used even outside the
24-hour customer-service window. Document media is uploaded only after approval.

Configure Meta's webhook at `https://YOUR_APP/api/webhooks/whatsapp`, with
`WHATSAPP_VERIFY_TOKEN` for the verification challenge and
`WHATSAPP_APP_SECRET` for raw-body HMAC verification. Subscribe to message
statuses. These routes authenticate Meta rather than staff OAuth tokens.

## Delivery and resending

Send commits the approved recipient selection and queues one delivery per
unique mobile. A Postgres-backed worker claims jobs across application
instances. Notification history distinguishes queued, provider-accepted,
delivered/read, failed, and uncertain results. Accepted does not mean delivered.
The invoice page shows the latest invoice and pickup notification statuses;
**View history** expands one entry per approved content version. Resending
unchanged content updates that entry's latest status and send count. Its
**Delivery details** retains every approved send, with recipient results under
each send. Earlier versions are read-only; resend is available from the latest
invoice and pickup entries and always previews the current invoice content.
The server rejects older resend links and a preview superseded by another send.
Opening, changing recipients, refreshing, or closing a preview adds no delivery
history. The history timestamp is the latest Send approval for that version.
The page loads the 100 most recent versions and always includes the latest
invoice and pickup entries, so a long history cannot hide either status.

Known transient failures retry the same approved payload with bounded backoff,
respecting `Retry-After` (up to 24 hours). `NOTIFICATION_MAX_ATTEMPTS` defaults
to five and supports 1–10 attempts. An interrupted message submission or an expired worker
lease is marked uncertain and is not automatically replayed: check delivery
before approving an explicit resend. Other accepted destinations are not
repeated when one destination fails. Each approved resend retains its own
delivery identity internally so late provider callbacks and retries cannot
overwrite a different send's results. The invoice page groups those sends under
their content version instead of adding a new history entry for each resend.

Changes to invoice content, payment, recipients, or pickup readiness make old
previews stale. Refresh and approve the current version. Reopening production
prevents an unstarted pickup notice from being sent. An external send already
in progress cannot be recalled.

Previews are temporary database rows so approval can verify the exact text,
recipients, and PDF shown. Closing a preview deletes its unapproved row and
recipient selections. Unchanged PDFs are reused from a short cache. Hourly
maintenance deletes abandoned previews after `NOTIFICATION_DRAFT_RETENTION_DAYS`
(default 1), and never-approved stale/cancelled previews. It removes unreferenced
PDFs older than `DOCUMENT_ORPHAN_RETENTION_DAYS` (default 1), and webhook payloads
older than `WHATSAPP_WEBHOOK_RETENTION_DAYS` (default 90). Approved sends and their
artifacts remain available, even if delivery later becomes stale or cancelled.
Include these retained documents in database backups. Preview disposal never
cancels or deletes an approved send.

## Verification

The backend has real-Postgres tests for readiness, bulk rollback, simultaneous
confirmations, duplicate mobiles, approval/version checks, artifact reuse,
worker claiming/retries, uncertain outcomes, and webhook ordering. Run with
Postgres 18 and `DATABASE_URL` pointing to a dedicated test database; SQLx
creates isolated databases for integration tests.

The real-renderer test is separate:

```sh
DOCUMENT_RENDERER_TEST_URL=http://localhost:53000 \
DOCUMENT_RENDERER_TEST_OUTPUT=/tmp/fabric-sync-invoice.pdf \
cargo test real_chromium -- --ignored
```

The document CI job also checks that the resulting PDF has multiple pages and
embeds the Arabic font. Provider tests use controlled local HTTP servers and
never contact Meta. Actual delivery still needs a staging smoke test with the
configured approved templates and a designated test recipient.

### Verified locally on 21 October 2026

- Backend: 235 tests passed, including temporary-preview disposal, approval races,
  cleanup, grouping resends by version, rejecting older resend links, and retaining
  both latest statuses in long histories. Formatting, compilation,
  fresh migrations, and `cargo sqlx prepare --check` passed.
- Frontend: 297 tests across 43 files passed; lint, formatting, and production
  build passed. Tests cover explicit approval, recipient grouping/selection,
  stale previews, successful/failed edits, skipping, and the separate resend
  button. A readiness transition preserves the open preview and its recipient
  selection without preparing it again. Closed and late-arriving previews are
  discarded; older sends and recipient delivery details expand on demand.
  Notification queries and mutations use separate hook files, and the touched
  screens use named React imports.
- Real Chromium (verified on 20 October): rendered a two-page A4 bilingual invoice with embedded
  Noto Sans Arabic fonts. The renderer test passed separately from the default
  backend suite.
- Local and production compose configurations validated. No deployment or real
  WhatsApp send was performed.
- The root env example contains only compose inputs. The production-configured
  renderer rejects HTTP(S) URLs and the URL route rejects local-file navigation;
  self-contained invoice conversion still passes with the file deny rule retained.
- The branch was rebased onto `ebd1b8a`, including the dynamic design catalog.
  The catalog integration test checks invalidation after a label change while
  retaining the original PDF.
- `tsc --noEmit` still reports 55 existing errors. Comparison with base revision
  `ebd1b8a` found the same errors; no new TypeScript errors were introduced.
