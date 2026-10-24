import { Link } from '@tanstack/react-router'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CURRENCY } from '@/lib/currency'
import type { ReturnContext } from '@/features/returns/types/returns'
import type { InvoicePayment } from '../types/invoice-detail'

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY,
})

export function InvoicePaymentHistory({
  payments,
  refunds,
}: {
  payments: InvoicePayment[]
  refunds: ReturnContext['refunds']
}) {
  const transactions = [
    ...payments.map((payment) => ({
      id: payment.id,
      type: 'Payment',
      date: payment.paidAt,
      method: payment.paymentType ?? '—',
      amount: payment.amount,
      orderId: payment.orderId,
      description: 'Invoice payment',
    })),
    ...refunds.map((refund) => ({
      id: refund.id,
      type: 'Refund',
      date: refund.createdAt,
      method: refund.giftCardCode
        ? `Gift card ${refund.giftCardCode}`
        : refund.paymentType,
      amount: -refund.amount,
      orderId: null,
      description: refund.reason,
    })),
  ].sort(
    (a, b) =>
      Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id),
  )

  return (
    <Table aria-label="Payments and refunds">
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Details</TableHead>
          <TableHead className="text-end">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((transaction) => (
          <TableRow key={`${transaction.type}-${transaction.id}`}>
            <TableCell>{new Date(transaction.date).toLocaleString()}</TableCell>
            <TableCell>{transaction.type}</TableCell>
            <TableCell className="capitalize">{transaction.method}</TableCell>
            <TableCell>
              {transaction.orderId ? (
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: transaction.orderId }}
                  className="text-info hover:underline"
                >
                  View order
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  {transaction.description}
                </span>
              )}
            </TableCell>
            <TableCell className="text-end font-medium tabular-nums">
              {currencyFormatter.format(transaction.amount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
