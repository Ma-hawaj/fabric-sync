# Database baseline

These migrations describe a fresh PostgreSQL 18+ database. They were consolidated
before deployment; there is no upgrade path from the previous migration history.

SQLx applies the files in version order:

1. `0001_core_schema.sql` creates the business tables, including the complete
   order lifecycle (`pending`, `ready`, `collected`), customer addresses,
   notification preferences, invoice collection method, and per-order urgency
   and automatic charges. The invoice charge column stores the computed sum of its
   order charges. Gift card recipient names and phone numbers are declared here.
2. `0002_notification_schema.sql` creates immutable PDF artifacts, notification
   previews and approvals, recipients, delivery attempts, webhook storage, and
   the staff-approved gift card delivery queue.
3. `0003_readiness_and_revisions.sql` creates the invoice-readiness view and the
   triggers that serialize related writes and invalidate outdated previews.
4. `0004_list_indexes.sql` adds indexes used by list queries and joins.

Reference data, the design catalog, and optional demo data live in `backend/seeds/`
and are loaded separately. Future deployed schema changes should be added as new
migrations rather than editing this baseline.
