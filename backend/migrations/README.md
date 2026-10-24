# Database baseline

These migrations describe a fresh PostgreSQL 18+ database. They were consolidated
before deployment; there is no upgrade path from the previous migration history.

SQLx applies the files in version order:

1. `0001_core_schema.sql` creates the business tables, including the complete
   order lifecycle (`pending`, `ready`, `collected`), customer addresses,
   notification preferences, invoice collection method, and per-order urgency
   and automatic charges. The invoice charge column stores the computed sum of its
   order charges. Numeric measurements use three decimal places to preserve
   eighth-inch fractions.
2. `0002_notification_schema.sql` creates immutable PDF artifacts, notification
   previews and approvals, recipients, delivery attempts, and webhook storage.
3. `0003_readiness_and_revisions.sql` creates the invoice-readiness view and the
   triggers that serialize related writes and invalidate outdated previews.
   Readiness excludes closed orders, and credits/refunds invalidate previews.
4. `0004_list_indexes.sql` adds indexes used by list queries and joins, including
   return-line lookups and the unique index allowing one closure per garment.

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
