# Database baseline

These migrations describe a fresh PostgreSQL 18+ database. They were consolidated
before deployment; there is no upgrade path from the previous migration history.

SQLx applies the files in version order:

1. `0001_core_schema.sql` creates the business tables, including the complete
   order lifecycle (`pending`, `ready`, `collected`) and notification preferences.
2. `0002_notification_schema.sql` creates immutable PDF artifacts, notification
   previews and approvals, recipients, delivery attempts, and webhook storage.
3. `0003_readiness_and_revisions.sql` creates the invoice-readiness view and the
   triggers that serialize related writes and invalidate outdated previews.
4. `0004_list_indexes.sql` adds indexes used by list queries and joins.
5. `20261019000000_customer_address_invoice_options.sql` adds customer addresses
   and invoice urgency and collection options.
6. `20261022000000_order_urgent_charges.sql` stores urgency charges on individual
   orders. Existing invoice charges are split across their orders in whole cents,
   preserving the charged total. The invoice column is a cached sum for new writes
   and preserves historical charges on invoices without tailoring orders.

Reference data, the design catalog, and optional demo data live in `backend/seeds/`
and are loaded separately. Future deployed schema changes should be added as new
migrations rather than editing this baseline.
