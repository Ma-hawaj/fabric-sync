# Invoice PDFs and WhatsApp notifications

Invoices and order readiness are saved independently of notifications. Creation
opens a preview, successful edits offer an updated-invoice resend preview, and
invoice detail/list actions offer **Resend invoice via WhatsApp**. Marking the
last uncollected order ready offers the pickup preview. Closing or skipping a
preview does not undo the saved invoice or readiness.

All invoice customers are selected by default. The server parses numbers using
`WHATSAPP_DEFAULT_REGION` and groups them by E.164 mobile, so local and
international representations of a shared number receive one notification.
The preview lists the customers sharing each destination. Invalid numbers and
disabled WhatsApp update preferences appear as exclusions; a disabled customer
sharing a mobile blocks that destination. Preferences can be changed on the
customer edit page and are independent of marketing messages.

## PDF rendering

Run `docker compose up -d document-renderer` and set
`DOCUMENT_RENDERER_URL=http://localhost:53000` in the backend's environment for
local development. The production compose file supplies the internal URL.

The pinned Gotenberg 8.38.0 image includes Noto Sans Arabic. Its browser cannot
fetch remote HTTP assets; invoice HTML, designs, logo, and QR are self-contained.
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

Configure a Meta WhatsApp Business sender using the variables in `.env.example`.
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

Known transient failures retry the same approved payload with bounded backoff,
respecting `Retry-After` (up to 24 hours). `NOTIFICATION_MAX_ATTEMPTS` defaults
to five and supports 1–10 attempts. An interrupted message submission or an expired worker
lease is marked uncertain and is not automatically replayed: check delivery
before approving an explicit resend. Other accepted destinations are not
repeated when one destination fails. A resend has its own reviewed draft and
delivery identity and retains earlier history.

Changes to invoice content, payment, recipients, or pickup readiness make old
previews stale. Refresh and approve the current version. Reopening production
prevents an unstarted pickup notice from being sent. An external send already
in progress cannot be recalled.

Hourly maintenance expires unapproved drafts after
`NOTIFICATION_DRAFT_RETENTION_DAYS` (default 30). It removes only unreferenced
PDFs older than `DOCUMENT_ORPHAN_RETENTION_DAYS` (default 30), and webhook
payloads older than `WHATSAPP_WEBHOOK_RETENTION_DAYS` (default 90). All artifacts
referenced by notification history remain available, including stale and
cancelled previews. Include these retained documents in database backups.

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

### Verified locally on 19 October 2026

- Backend: 226 tests passed, including upgrading a database with existing
  customers, pending/collected orders, and payments. Formatting, compilation,
  fresh migrations, and `cargo sqlx prepare --check` passed.
- Frontend: 284 tests across 40 files passed; lint, formatting, and production
  build passed. Tests cover explicit approval, recipient grouping/selection,
  stale previews, successful/failed edits, skipping, and the separate resend
  button.
- Real Chromium: rendered a two-page A4 bilingual invoice with embedded
  Noto Sans Arabic fonts. The renderer test passed separately from the default
  backend suite.
- Local and production compose configurations validated. No deployment or real
  WhatsApp send was performed.
- The branch was rebased onto `ebd1b8a`, including the dynamic design catalog.
  The catalog integration test checks invalidation after a label change while
  retaining the original PDF.
- `tsc --noEmit` still reports 55 existing errors. Comparison with base revision
  `ebd1b8a` found the same errors; no new TypeScript errors were introduced.
