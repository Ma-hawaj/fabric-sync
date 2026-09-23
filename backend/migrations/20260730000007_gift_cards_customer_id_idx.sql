-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS gift_cards_customer_id_idx ON gift_cards (customer_id);
