-- A permanent sequence within each customer; UUIDs remain relational keys.
ALTER TABLE measurements ADD COLUMN measurement_number BIGINT;

WITH numbered AS (
    SELECT id, row_number() OVER (
        PARTITION BY customer_id ORDER BY measurement_date, id
    ) AS number FROM measurements
)
UPDATE measurements m SET measurement_number = numbered.number
FROM numbered WHERE numbered.id = m.id;

ALTER TABLE measurements
    ALTER COLUMN measurement_number SET NOT NULL,
    ADD CONSTRAINT measurements_number_positive CHECK (measurement_number > 0),
    ADD CONSTRAINT measurements_customer_number_key UNIQUE (customer_id, measurement_number);

-- Keep the counter even if a measurement is deleted so saved IDs are never reused.
CREATE TABLE customer_measurement_counters (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    last_number BIGINT NOT NULL CHECK (last_number > 0)
);
INSERT INTO customer_measurement_counters (customer_id, last_number)
SELECT customer_id, max(measurement_number) FROM measurements GROUP BY customer_id;

CREATE FUNCTION assign_measurement_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.measurement_number IS NOT NULL THEN
        RAISE EXCEPTION 'measurement number is assigned automatically' USING ERRCODE = '23514';
    END IF;
    INSERT INTO customer_measurement_counters (customer_id, last_number)
    VALUES (NEW.customer_id, 1)
    ON CONFLICT (customer_id) DO UPDATE
        SET last_number = customer_measurement_counters.last_number + 1
    RETURNING last_number INTO NEW.measurement_number;
    RETURN NEW;
END $$;
CREATE TRIGGER measurements_assign_number BEFORE INSERT ON measurements
    FOR EACH ROW EXECUTE FUNCTION assign_measurement_number();

CREATE FUNCTION preserve_measurement_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.customer_id, NEW.measurement_number) IS DISTINCT FROM
       (OLD.customer_id, OLD.measurement_number) THEN
        RAISE EXCEPTION 'measurement identity cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER measurements_preserve_number BEFORE UPDATE OF customer_id, measurement_number
    ON measurements FOR EACH ROW EXECUTE FUNCTION preserve_measurement_number();

CREATE FUNCTION readable_measurement_id(customer_number BIGINT, measurement_number BIGINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT 'CSTMR-' || customer_number::text || '-' ||
        lpad(measurement_number::text, greatest(3, length(measurement_number::text)), '0')
$$;
