-- Keep UUIDs as relational keys; staff quote the separate CSTMR-<number>.
ALTER TABLE customers
    ADD COLUMN customer_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE;
