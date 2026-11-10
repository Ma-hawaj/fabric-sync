SELECT e.id, e.branch_id, e.business_date, e.amount::float8 AS "amount!",
       e.payment_type, e.reason, e.paid_to, e.reference, e.recorded_at, e.recorded_by,
       e.request_hash,
       v.recorded_at AS "voided_at?", v.reason AS "void_reason?",
       v.recorded_by AS "voided_by?", v.request_id AS "void_request_id?",
       v.request_hash AS "void_request_hash?"
FROM branch_expenses e LEFT JOIN branch_expense_voids v ON v.expense_id = e.id
WHERE ($1::uuid IS NULL OR e.branch_id = $1)
  AND ($2::date IS NULL OR e.business_date = $2)
  AND ($3::uuid IS NULL OR e.request_id = $3)
  AND ($4::uuid IS NULL OR e.id = $4)
ORDER BY e.recorded_at, e.id
