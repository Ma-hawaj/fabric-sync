# Database baseline

These migrations describe a fresh PostgreSQL 18+ database. They were consolidated
before deployment; there is no upgrade path from the previous migration history.

SQLx applies the files in version order:

1. `0001_core_schema.sql` creates the business tables, including independent stock, pickup, and production capabilities and the complete
   order lifecycle (`pending`, `ready`, `collected`), customer addresses,
   notification preferences, invoice collection method, a separate issuing branch
   with its saved name, per-order urgency and automatic charges, and the saved
   VAT-inclusive delivery fee. Pickup invoices have no delivery fee. Delivery uses
   the customer address; the existing invoice branch is the pickup destination.
   Invoices snapshot the applied VAT rate and rounded
   taxable/VAT amounts so later configuration changes cannot alter issued tax figures. The invoice charge column stores the computed sum of its
   order charges. Numeric measurements use three decimal places to preserve
   eighth-inch fractions. Gift card recipient names and phone numbers are
   declared here. Direct material sales are invoice items with a material reference,
   the stock location, and a description/unit snapshot; they share the existing
   return-credit and refund tables. Gift-card issuer attribution, replacement
   links, original-card traversal, and the invoice voucher-accounting view are
   part of this original baseline. A card may have at most one direct replacement;
   sale history stays attached to the original card. Legacy orders may have an
   unknown fabric source with a null material reference; shop/customer material
   constraints remain enforced.
2. `0002_notification_schema.sql` creates immutable PDF artifacts, notification
   previews and approvals, recipients, delivery attempts, webhook storage, and
   the staff-approved gift card delivery queue with its immutable PNG attachments.
3. `0003_readiness_and_revisions.sql` creates the invoice-readiness view and the
   triggers that serialize related writes and invalidate outdated previews.
   Readiness excludes closed orders, and credits/refunds invalidate previews.
4. `0004_list_indexes.sql` adds indexes used by list queries and joins, including
   return-line lookups and the unique index allowing one closure per garment.
5. `0005_notification_requests.sql` records notification work created by invoice
   saves, pickup confirmations, and repair completions. It deliberately does not
   backfill existing records: imports and historical data are not a notification
   backlog. Existing approved delivery attempts remain available independently.

The core schema defines readable customer IDs (`C-6216`) and permanent
per-customer measurement IDs (`C-6216-001`) alongside their UUID keys.
Customer numbers use an identity sequence; the workbook importer preserves each
customer's highest legacy Measurement No and advances the sequence beyond the
workbook's range. A measurement counter and insert trigger serialize concurrent
saves and retain used numbers after deletion. Imports and app-created snapshots
use the same allocation trigger.

The core schema also defines return credits and lines, refund payouts,
cancellation details, original fabric stock locations, and balance/outcome views.
Return lines store their chosen restock location with a foreign key and require a
destination exactly when stock was restored; the original sale location remains
on the invoice item.
Adjustment retry checks store a 32-byte SHA-256 hash, not the request JSON;
structured credit, stock and refund records retain the audit details.
Standalone payments also store paired request IDs/hashes with per-invoice
uniqueness. Both columns remain null for creation, collection and import writes.
The core baseline also stores `invoices.created_by` and
`invoice_payments.recorded_by` as nullable authenticated staff subjects. Application
writes populate them; imports without a known actor leave them null.

Reference data, the design catalog, and optional demo data live in `backend/seeds/`
and are loaded separately. Future deployed schema changes should be added as new
migrations rather than editing this baseline.
